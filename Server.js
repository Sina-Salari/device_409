var net = require('net');
//var port = process.env.PORT || 5453;
var server = net.createServer();;
const request = require('request');
var fs = require("fs");
const sql = require('mssql');
const cryptoEngine = require('./crypto-engine');
var moment = require('moment-timezone');
var momentFa = require("jalali-moment");
var config = {};
var baseTblTariffSchedules;
var DeviceIpToSrl = {};
var DeviceCodeToSrl = {}
var nationalCodeFunctional = false;
var TariffSrlToDevicesSrls = {};
var monitoringUrl;
var messageBuffers = {};

const STATES = {
    Open: "1",
    Close: "2",
    Duplicate: "3",
    Error: "4",
    Fake: "5",
    Used: "6",
    InvalidSchedule: "7",
    InvalidDevice: "8",
    Expired: "9",
    Inactive: "10",
    MaxReached: "11"
};

const STATE2MSTATE = {
    [STATES.Open]: "1",
    [STATES.Close]: "2",
    [STATES.Duplicate]: "3",
    [STATES.Error]: "4",
    [STATES.Fake]: "2",
    [STATES.Used]: "3",
    [STATES.InvalidSchedule]: "2",
    [STATES.InvalidDevice]: "2",
    [STATES.Expired]: "3",
    [STATES.Inactive]: "2",
    [STATES.MaxReached]: "2",
}


readCnnString(function (response) {
    config = {
        user: cryptoEngine.decrypt("MadaktoCompany", response.Sql.user),
        password: cryptoEngine.decrypt("MadaktoCompany", response.Sql.password),
        server: cryptoEngine.decrypt("MadaktoCompany", response.Sql.server),
        database: cryptoEngine.decrypt("MadaktoCompany", response.Sql.database),
        serverIp: response.ServerIp
    };
    nationalCodeFunctional = response.CheckNationalCode;
    monitoringUrl = response.MonitoringUrl;
    getTariffSchedules(function (rows) {
        baseTblTariffSchedules = rows;
    });
    getDevicesInfo(function (rows) {
        for (i = 0; i < rows.length; i++) {
            DeviceCodeToSrl[pad_with_zeroes(rows[i].DeviceCode, 3)] = rows[i].DeviceSrl;
            DeviceIpToSrl[pad_with_zeroes(rows[i].DeviceCode, 3)] = rows[i].DeviceIpAddress;
        }
    });
    getTariffsInfo(function (rows) {
        for (i = 0; i < rows.length; i++) {
            TariffSrlToDevicesSrls[rows[i].TariffSrl.toString()] = rows[i].DevicesSrls.split(',');
        }
    });
});

let publicConfigs = JSON.parse(fs.readFileSync('appsettings.json', { encoding: "utf-8" }).trim());
server.listen(publicConfigs.Port);
console.log("..... TCP server listening on %d", publicConfigs.Port);

server.on("connection", function (socket) {
    console.info("Socket connection open");
    console.info(socket.remoteAddress);
    messageBuffers[socket.remoteAddress] = "";

    socket.on("ready", function (data) {

    });

    socket.on("data", async function (data) {

        if (data.indexOf("\n") > -1) {
            messageBuffers[socket.remoteAddress] += data;
            let boardMessage = messageBuffers[socket.remoteAddress].split('#');
            if (boardMessage[0].toString().trim() == "") {
                return;
            }
            console.log("=======================================" + new Date());
            console.log("Socket received a message : " + messageBuffers[socket.remoteAddress]);
            messageBuffers[socket.remoteAddress] = "";
            if (boardMessage.length === 2) {
                if (boardMessage[0].toString().trim().startsWith('*')) {
                    await checkBarcodeValidity(boardMessage, function (response, ticketValue, deviceIP, state) {
                        sendData(socket, response, ticketValue, deviceIP, state);
                    });
                }
                else {
                    //console.log(boardMessage[0].substring(0, 1));
                    //console.log(boardMessage[0].toString());
                    console.log("** Received message is invalid **");
                }
            }
            else {
                console.log("==============================================================================");
                console.log("== Received message is invalid ==");
            }
        }
        else {
            //console.log(data.toString());
            messageBuffers[socket.remoteAddress] += data;
        }

        //socket.write("Recieved");
    });

    socket.on('drain', function () {
        console.log('write buffer is empty now .. u can resume the writable stream');
        socket.resume();
    });

    socket.on('error', function (error) {
        console.log('Error : ' + error);
    });

    socket.on('timeout', function () {
        console.log('Socket timed out !');
        socket.end('Timed out!');
    });

    socket.on('end', function (data) {
        console.log('Socket ended from other end!');
        messageBuffers[socket.remoteAddress] = "";
        socket.end();
    });

    socket.on('close', function (error) {
        if (error) {
            console.log('Socket was closed because of transmission error');
            messageBuffers[socket.remoteAddress] = "";
        }
    });

});

server.on('error', function (error) {
    console.log('Error: ' + error);
});

function sendData(socket, result, ticketValue, deviceIP, state) {
    console.log("Server sent a message to (" + deviceIP + ") : " + result + deviceIP.substring(1, 3));
    console.log("==============================================================================");
    socket.write(result + deviceIP.substring(1, 3), 'utf8', function (err) {
        if (typeof err !== "undefined") {
            console.log(err);
            state = STATES.Error;
        }
        if (monitoringUrl !== "") {
            sendToMonitoringSystem(ticketValue, deviceIP, state);
            submitDeviceSubmission(ticketValue, deviceIP, state);
        }
    });
}

function executeQueryOutSourced(ticketNumber, deviceCode, expectedResult, callback) {
    let pool = new sql.ConnectionPool(config);
    pool.connect(function (err) {
        if (err) console.log("sql err : " + err);
        let request = new sql.Request(pool);
        request.query("SELECT TOP 1 OutSourcedTicketSrl FROM baseTblOutSourcedTicket WHERE OutSourcedTicketValue=\'" + ticketNumber + "\'", function (err, recordset) {
            if (err) console.log(err);
            if (recordset.recordset.length === 0) {
                request.query("Insert into baseTblOutSourcedTicket(OutSourcedTicketValue, OutSourcedTicketUsedTime, UsedDeviceSrl) Values(\'" + ticketNumber + "\'," + getCSharpTick() + "," + (typeof DeviceCodeToSrl[deviceCode] !== 'undefined' ? DeviceCodeToSrl[deviceCode] : -1) + ")").then(result => {
                    if (result.rowsAffected > 0) {
                        //console.log("result.rowsAffected  : " + result.rowsAffected);
                        return callback(expectedResult, ticketNumber, deviceCode, STATES.Open);
                    }
                    else {
                        console.log("OutSourced ticket record can not insert!!!");
                        return callback("S", ticketNumber, deviceCode, STATES.Error);
                    }
                });
            }
            else {
                console.log("OutSourced ticket is used before!!");
                return callback("S", ticketNumber, deviceCode, STATES.Duplicate);
            }
        });
    });
}

function executeQueryMadakto(ticketNumber, deviceCode, expectedResult, callback) {
    let pool = new sql.ConnectionPool(config);
    pool.connect(function (err) {
        if (err) console.log("sql err : " + err);
        //console.log("deviceCode : " + DeviceCodeToSrl[deviceCode].toString());
        //console.log("deviceIp : " + DeviceIpToSrl[deviceCode]);
        let request = new sql.Request(pool);
        request.query('Select * From baseTblTickets Where TicketSrl=' + ticketNumber, function (err, recordset) {
            if (err) console.log(err);
            if (recordset.recordset.length > 0) {

                if (recordset.recordset[0].EventSrl !== -1) {
                    request.input("EventSrl", sql.VarChar, recordset.recordset[0].EventSrl)
                        .query(`SELECT TOP 1 *  FROM [baseTblEvents] WHERE [EventSrl] = @EventSrl AND [EndDateTicks] > ${getCSharpTick()} AND [IsDeleted] = 0`, function (err, eventRecordset) {

                            if (eventRecordset.recordset.length === 0) {
                                console.log("Event is expired or not found!!!");
                                return callback("S", ticketNumber, deviceCode, STATES.Fake);
                            }
                        });
                }

                //console.log("SubmissionDateTicks : " + recordset.recordset[0].IsUsed);
                if (recordset.recordset[0].IsUsed === false && (recordset.recordset[0].ExpirationDateTicks == 0 || recordset.recordset[0].ExpirationDateTicks >= getCSharpTick())) {
                    let validTickets = false;
                    let yesterdayDate = new Date();
                    let currDateT = new Date();
                    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
                    request.query('Select * From baseTblReceptions Where ReceptionSrl=' + recordset.recordset[0].ReceptionSrl, function (err, receptionRecordset) {
                        //console.log("TariffSrl : " + receptionRecordset.recordset[0].TariffSrls + "   #Day: " + currDateT.getDay());
                        if ((typeof DeviceCodeToSrl[deviceCode] !== 'undefined' ? true : false) && (typeof TariffSrlToDevicesSrls[receptionRecordset.recordset[0].TariffSrls] !== 'undefined' ? true : false) && TariffSrlToDevicesSrls[receptionRecordset.recordset[0].TariffSrls].indexOf(DeviceCodeToSrl[deviceCode].toString()) !== -1) {
                            if (baseTblTariffSchedules.length > 0) {
                                let todaySchedule = baseTblTariffSchedules.filter(s => s.TariffSrl == receptionRecordset.recordset[0].TariffSrls && s.Day == currDateT.getDay());
                                if (todaySchedule.length > 0) {
                                    if (getTimeFormat(currDateT) >= todaySchedule[0].FromTime &&
                                        getTimeFormat(currDateT) <= todaySchedule[0].ToTime) {
                                        validTickets = true;
                                    }
                                }
                                if (validTickets === false) {
                                    let yesterdaySchedule = baseTblTariffSchedules.filter(s => s.TariffSrl == receptionRecordset.recordset[0].TariffSrls && s.Day == yesterdayDate.getDay());
                                    if (yesterdaySchedule.length > 0) {
                                        if (getTimeFormat(currDateT) <= yesterdaySchedule[0].OverTime) {
                                            validTickets = true;
                                        }
                                    }
                                }
                                if (validTickets) {
                                    request.query('update baseTblTickets set IsUsed = ' + 1 + ',UsedDeviceSrl=' + (typeof DeviceCodeToSrl[deviceCode] !== 'undefined' ? DeviceCodeToSrl[deviceCode] : -1) + ' where TicketSrl=' + ticketNumber).then(result => {
                                        if (result.rowsAffected > 0) {
                                            request.query('update baseTblReceptions set SubmissionDateTicks = ' + getCSharpTick() + ' Where ReceptionSrl=' + recordset.recordset[0].ReceptionSrl).then(result => {
                                                if (result.rowsAffected > 0) {
                                                    //console.log("result.rowsAffected  : " + result.rowsAffected);
                                                    return callback(expectedResult, ticketNumber, deviceCode, STATES.Open);
                                                }
                                                else {
                                                    console.log("Record can not update1!!!");
                                                    return callback("S", ticketNumber, deviceCode, STATES.Error);
                                                }
                                            });
                                        }
                                        else {
                                            console.log("Record can not update2!!!");
                                            return callback("S", ticketNumber, deviceCode, STATES.Error);
                                        }
                                    });
                                }
                                else {
                                    console.log("Ticket is not valid to use in this hour!!!");
                                    return callback("S", ticketNumber, deviceCode, STATES.InvalidSchedule);
                                }
                            }
                            else {
                                request.query('update baseTblTickets set IsUsed = ' + 1 + ',  UsedDeviceSrl= ' + (typeof DeviceCodeToSrl[deviceCode] !== 'undefined' ? DeviceCodeToSrl[deviceCode] : -1) + ' where TicketSrl=' + ticketNumber).then(result => {
                                    if (result.rowsAffected > 0) {
                                        return callback(expectedResult, ticketNumber, deviceCode, STATES.Open);
                                    }
                                    else {
                                        console.log("Record can not update!!!");
                                        return callback("S", ticketNumber, deviceCode, STATES.Error);
                                    }
                                });
                            }
                        }
                        else {
                            console.log("This tariff is not accessible through this device!!!");
                            return callback("S", ticketNumber, deviceCode, STATES.InvalidDevice);
                        }
                    });
                }
                else {
                    console.log("Ticket is used before or expired!!");
                    return callback("S", ticketNumber, deviceCode, STATES.Duplicate);
                }
            }
            else {
                console.log("Ticket not found in database!!!");
                return callback("S", ticketNumber, deviceCode, STATES.Fake);
            }
        });
    });
}

function executeQueryMadaktoBulkCode(ticketNumber, deviceCode, expectedResult, callback) {
    let pool = new sql.ConnectionPool(config);
    pool.connect(function (err) {
        if (err) console.log("sql err : " + err);
        let request = new sql.Request(pool);
        request.query('Select * From baseTblTickets Where TicketSrl=' + ticketNumber, function (err, recordset) {
            if (err) console.log(err);
            if (recordset.recordset.length > 0) {
                console.log("recordset.recordset[0].ExpirationDateTicks : " + recordset.recordset[0].ExpirationDateTicks);
                if (recordset.recordset[0].IsUsed === false && (recordset.recordset[0].ExpirationDateTicks == 0 || recordset.recordset[0].ExpirationDateTicks >= getCSharpTick())) {
                    request.query('Select * From baseTblBulkReceptions Where BulkReceptionSrl=' + recordset.recordset[0].ReceptionSrl, function (err, receptionRecordset) {
                        if (receptionRecordset.recordset[0].IsValid) {
                            if ((typeof DeviceCodeToSrl[deviceCode] !== 'undefined' ? true : false) && (typeof TariffSrlToDevicesSrls[receptionRecordset.recordset[0].TariffSrls] !== 'undefined' ? true : false) && TariffSrlToDevicesSrls[receptionRecordset.recordset[0].TariffSrls].indexOf(DeviceCodeToSrl[deviceCode].toString()) !== -1) {
                                request.query('update baseTblTickets set IsUsed = ' + 1 + ',  UsedDeviceSrl= ' + (typeof DeviceCodeToSrl[deviceCode] !== 'undefined' ? DeviceCodeToSrl[deviceCode] : -1) + ' where TicketSrl=' + ticketNumber).then(result => {
                                    if (result.rowsAffected > 0) {
                                        //console.log("Ticket Update result : " + result.rowsAffected + ' ' + recordset.recordset[0].ReceptionSrl);
                                        request.query('update baseTblBulkReceptions set TicketCountRemaining = TicketCountRemaining - 1' + ' where BulkReceptionSrl=' + recordset.recordset[0].ReceptionSrl).then(result => {
                                            if (result.rowsAffected > 0) {
                                                //console.log("Bulk Reception Record Updated  : " + result.rowsAffected);
                                                return callback(expectedResult, ticketNumber, deviceCode, STATES.Open);
                                            }
                                            else {
                                                console.log("Bulk Reception Record Update Failed" + result.rowsAffected);
                                                return callback("S", ticketNumber, deviceCode, STATES.Error);
                                            }
                                        });

                                    }
                                });
                            }
                            else {
                                console.log("This tariff is not accessible through this device!!!");
                                return callback("S", ticketNumber, deviceCode, STATES.InvalidDevice);
                            }
                        }
                        else {
                            console.log("This ticket is not active!!!");
                            return callback("S", ticketNumber, deviceCode, STATES.Inactive);
                        }
                    });
                }
                else {
                    console.log("Ticket is used before or expired!!");
                    return callback("S", ticketNumber, deviceCode, STATES.Expired);
                }
            }
            else {
                console.log("Ticket not found in database!!!");
                return callback("S", ticketNumber, deviceCode, STATES.Fake);
            }
        });
    });
}

async function executeQueryMadaktoNationalCode(nationalCode, deviceCode, expectedResult, callback) {
    try {
        let connection = await new sql.ConnectionPool(config).connect();
        let request = new sql.Request(connection);
        let recordset = await request
            .input("NationalCode", sql.VarChar, nationalCode)
            .query(`SELECT TOP 1 * FROM [baseTblTickets] WHERE [Type] = 1 AND [ExpirationDateTicks] > (Select [dbo].[DateTimeToTicks](GETDATE())) AND NationalCode = @NationalCode AND IsUsed = 0
                SELECT COUNT([GatePassSrl]) [Count] FROM [baseTblGatePasses] WHERE [UseNationalCode] = 1 AND [NationalCode] = @NationalCode AND [IsDeleted] = 0`);

        if (recordset.recordsets[1][0].Count > 0) {
            console.log("Ticket type is gate pass!!!");
            var res = await executeQueryGateTrafficPass(nationalCode, deviceCode, expectedResult, true, callback);
            if (res !== false) {
                return res;
            }
            console.log("Check has a ticket or not...");
        }

        if (recordset.recordset.length === 0) {
            console.log("Ticket not found, expired or used in database!!!");
            return callback("S", nationalCode, deviceCode, STATES.Fake);
        }

        if (recordset.recordset[0].EventSrl !== -1) {
            let requestEvent = new sql.Request(connection);
            let eventRecordset = await requestEvent
                .input("EventSrl", sql.VarChar, recordset.recordset[0].EventSrl)
                .query(`SELECT TOP 1 *  FROM [baseTblEvents] WHERE [EventSrl] = @EventSrl AND [EndDateTicks] > ${getCSharpTick()} AND [IsDeleted] = 0`);

            if (eventRecordset.recordset.length === 0) {
                console.log("Event is expired or not found!!!");
                return callback("S", ticketNumber, deviceCode, STATES.Fake);
            }
        }

        let ticketNumber = recordset.recordset[0].TicketSrl;
        let validTickets = false;
        let yesterdayDate = new Date();
        let currDateT = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);

        let receptionRecordset = await request.query('Select * From baseTblReceptions Where ReceptionSrl=' + recordset.recordset[0].ReceptionSrl);
        if ((typeof DeviceCodeToSrl[deviceCode] !== 'undefined' ? true : false) && (typeof TariffSrlToDevicesSrls[receptionRecordset.recordset[0].TariffSrls] !== 'undefined' ? true : false) && TariffSrlToDevicesSrls[receptionRecordset.recordset[0].TariffSrls].indexOf(DeviceCodeToSrl[deviceCode].toString()) !== -1) {
            if (baseTblTariffSchedules.length > 0) {
                let todaySchedule = baseTblTariffSchedules.filter(s => s.TariffSrl == receptionRecordset.recordset[0].TariffSrls && s.Day == currDateT.getDay());
                if (todaySchedule.length > 0) {
                    if (getTimeFormat(currDateT) >= todaySchedule[0].FromTime &&
                        getTimeFormat(currDateT) <= todaySchedule[0].ToTime) {
                        validTickets = true;
                    }
                }

                if (validTickets === false) {
                    let yesterdaySchedule = baseTblTariffSchedules.filter(s => s.TariffSrl == receptionRecordset.recordset[0].TariffSrls && s.Day == yesterdayDate.getDay());
                    if (yesterdaySchedule.length > 0) {
                        if (getTimeFormat(currDateT) <= yesterdaySchedule[0].OverTime) {
                            validTickets = true;
                        }
                    }
                }

                if (validTickets === false) {
                    console.log("Ticket is not valid to use in this hour!!!");
                    return callback("S", nationalCode, deviceCode, STATES.InvalidSchedule);
                }

                let result = await request.query('update baseTblTickets set IsUsed = ' + 1 + ',UsedDeviceSrl=' + (typeof DeviceCodeToSrl[deviceCode] !== 'undefined' ? DeviceCodeToSrl[deviceCode] : -1) + ' where TicketSrl=' + ticketNumber);
                if (result.rowsAffected === 0) {
                    console.log("Record can not update2!!!");
                    return callback("S", nationalCode, deviceCode, STATES.Error);
                }

                result = await request.query('update baseTblReceptions set SubmissionDateTicks = ' + getCSharpTick() + ' Where ReceptionSrl=' + recordset.recordset[0].ReceptionSrl);
                if (result.rowsAffected === 0) {
                    console.log("Record can not update1!!!");
                    return callback("S", nationalCode, deviceCode, STATES.Error);
                }

                //console.log("result.rowsAffected  : " + result.rowsAffected);
                return callback(expectedResult, nationalCode, deviceCode, STATES.Open);
            }
            else {
                let result = await request.query('update baseTblTickets set IsUsed = ' + 1 + ',  UsedDeviceSrl= ' + (typeof DeviceCodeToSrl[deviceCode] !== 'undefined' ? DeviceCodeToSrl[deviceCode] : -1) + ' where TicketSrl=' + ticketNumber);
                if (result.rowsAffected === 0) {
                    console.log("Record can not update!!!");
                    return callback("S", nationalCode, deviceCode, STATES.Error);
                }

                return callback(expectedResult, nationalCode, deviceCode, STATES.Open);
            }
        }
        else {
            console.log("This tariff is not accessible through this device!!!");
            return callback("S", nationalCode, deviceCode, STATES.InvalidDevice);
        }
    } catch (exp) {
        console.log("sql err : " + exp);
    }
}

async function executeQueryGateTrafficPass(passNumber, deviceCode, expectedResult, useNationalCode, callback) {
    try {
        let connection = await new sql.ConnectionPool(config).connect();
        let request = new sql.Request(connection);
        let recordset = await request
            .input("Parameter", useNationalCode ? sql.VarChar : sql.BigInt, passNumber)
            .query(`SELECT TOP 1 * FROM [baseTblGatePasses] WHERE ${(useNationalCode ? "[UseNationalCode] = 1 AND [NationalCode]" : "[GatePassSrl]")} = @Parameter AND [IsDeleted] = 0`);

        if (recordset.recordset.length === 0) {
            console.log("Pass not found in database!!!");

            if (useNationalCode) {
                return false;
            }

            return callback("S", passNumber, deviceCode, STATES.Fake);
        }

        let ticketNumber = recordset.recordset[0].GatePassSrl;
        if (recordset.recordset[0].EventSrl !== -1) {
            let requestEvent = new sql.Request(connection);
            let eventRecordset = await requestEvent
                .input("EventSrl", sql.VarChar, recordset.recordset[0].EventSrl)
                .query(`SELECT TOP 1 *  FROM [baseTblEvents] WHERE [EventSrl] = @EventSrl AND [EndDateTicks] > ${getCSharpTick()} AND [IsDeleted] = 0`);

            if (eventRecordset.recordset.length === 0) {
                console.log("Event is expired or not found!!!");

                if (useNationalCode) {
                    return false;
                }

                return callback("S", passNumber, deviceCode, STATES.Fake);
            }

            if (typeof DeviceCodeToSrl[deviceCode] === 'undefined' || recordset.recordset[0].AllowedDeviceSrls.split(',').indexOf(DeviceCodeToSrl[deviceCode].toString()) < 0) {
                console.log("This pass is not accessible through this device!!!");

                if (useNationalCode) {
                    return false;
                }

                return callback("S", passNumber, deviceCode, STATES.InvalidDevice);
            }

            let requestPassageRecords = new sql.Request(connection);
            let passageCountRecordset = await requestPassageRecords
                .query(`SELECT COUNT(*) AS PassageCount FROM [baseTblGatePassRecords] WHERE [GatePassSrl] = ${ticketNumber}`);

            if (passageCountRecordset.recordset[0].PassageCount >= recordset.recordset[0].AllowedCount) {
                console.log("Maximum number of passes reached!!!");

                if (useNationalCode) {
                    return false;
                }

                return callback("S", passNumber, deviceCode, STATES.MaxReached);
            }

            let result = await request
                .query(`INSERT INTO [baseTblGatePassRecords] ([SubmissionTicks], [GatePassSrl], [UsedDeviceSrl]) VALUES (${getCSharpTick()}, ${ticketNumber}, ${(typeof DeviceCodeToSrl[deviceCode] !== 'undefined' ? DeviceCodeToSrl[deviceCode] : -1)})`);

            if (result.rowsAffected === 0) {
                console.log("Cannot insert passage record!!!");

                if (useNationalCode) {
                    return false;
                }

                return callback("S", passNumber, deviceCode, STATES.Error);
            }

            return callback(expectedResult, passNumber, deviceCode, STATES.Open);
        }
        else {
            if (typeof DeviceCodeToSrl[deviceCode] === 'undefined' || recordset.recordset[0].AllowedDeviceSrls.split(',').indexOf(DeviceCodeToSrl[deviceCode].toString()) < 0) {
                console.log("This pass is not accessible through this device!!!");

                if (useNationalCode) {
                    return false;
                }

                return callback("S", passNumber, deviceCode, STATES.InvalidDevice);
            }

            let requestPassageRecords = new sql.Request(connection);
            let passageCountRecordset = await requestPassageRecords
                .query(`SELECT COUNT(*) AS PassageCount FROM [baseTblGatePassRecords] WHERE [GatePassSrl]=${ticketNumber}`);

            if (passageCountRecordset.recordset[0].PassageCount >= recordset.recordset[0].AllowedCount) {
                console.log("Maximum number of passes reached!!!");

                if (useNationalCode) {
                    return false;
                }

                return callback("S", passNumber, deviceCode, STATES.MaxReached);
            }

            let result = await request
                .query(`INSERT INTO [baseTblGatePassRecords] ([SubmissionTicks], [GatePassSrl], [UsedDeviceSrl]) VALUES (${getCSharpTick()}, ${ticketNumber}, ${(typeof DeviceCodeToSrl[deviceCode] !== 'undefined' ? DeviceCodeToSrl[deviceCode] : -1)})`);

            if (result.rowsAffected === 0) {
                console.log("Cannot insert passage record!!!");

                if (useNationalCode) {
                    return false;
                }

                return callback("S", passNumber, deviceCode, STATES.Error);
            }

            return callback(expectedResult, passNumber, deviceCode, STATES.Open);
        }
    } catch (exp) {
        console.log("sql err : " + exp);

        if (useNationalCode) {
            return false;
        }
    }
}

function hexToDec(hex) {
    let result = 0, digitValue;
    hex = hex.toLowerCase();
    for (let i = 0; i < hex.length; i++) {
        digitValue = '0123456789abcdefgh'.indexOf(hex[i]);
        result = result * 16 + digitValue;
    }
    return result;
}

function encodeTicket(cryptoStr) {
    let crypto = require('crypto')
        , text = "" + cryptoStr + ""
        , key = 'tallEm@><>=+mELlat'
        , hash

    hash = crypto.createHmac('sha256', key).update(text).digest('hex');
    return hash;
}

function getCSharpTick() {
    let momentNow = moment.tz("Asia/Tehran");
    let dtNow = momentNow.unix() + momentNow.utcOffset() * 60;
    let epochTicks = 621355968000000000;
    let ticksPerMillisecond = 10000000;
    return ((dtNow * ticksPerMillisecond) + epochTicks);
}

function readCnnString(callback) {
    let publicConfigs = fs.readFileSync('appsettings.json', { encoding: "utf-8" }).trim();
    publicConfigs = JSON.parse(publicConfigs);
    return callback(publicConfigs);
}

function getTariffSchedules(callback) {
    let pool = new sql.ConnectionPool(config);
    pool.connect(function (err) {
        if (err) console.log("sql err : " + err);
        let request = new sql.Request(pool);
        request.query('select * from baseTblTariffSchedules', function (err, recordset) {
            return callback(recordset.recordset);
        });
    });
}

function getDevicesInfo(callback) {
    let pool = new sql.ConnectionPool(config);
    pool.connect(function (err) {
        if (err) console.log("sql err : " + err);
        let request = new sql.Request(pool);
        let currDateT = new Date();
        request.query('select * from baseTblDevices where DeviceType=0', function (err, recordset) {
            return callback(recordset.recordset);
        });
    });
}

function getTariffsInfo(callback) {
    let pool = new sql.ConnectionPool(config);
    pool.connect(function (err) {
        if (err) console.log("sql err : " + err);
        let request = new sql.Request(pool);
        let currDateT = new Date();
        request.query('select * from baseTblTariffs where IsActive=1', function (err, recordset) {
            return callback(recordset.recordset);
        });
    });
}

function getTimeFormat(date) {
    let hours = date.getHours();
    let minutes = date.getMinutes();
    hours = hours < 10 ? '0' + hours : hours;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return hours + ':' + minutes + ':00';
}

function checkValidSoftware() {
    let isValid = 1;
    let currMadaktoDate = new Date();
    let fetureDate = new Date("12/29/2019");
    let pastDate = new Date("07/06/2020");
    if (currMadaktoDate < pastDate) {
        isValid = 0;
    }
    if (currMadaktoDate > fetureDate) {
        isValid = 0;
    }
    return isValid;
}

function isValidIranianNationalCode(input) {
    if (!/^\d{10}$/.test(input))
        return false;
    var check = parseInt(input[9]);
    var sum = 0;
    var i;
    for (i = 0; i < 9; ++i) {
        sum += parseInt(input[i]) * (10 - i);
    }
    sum %= 11;
    return (sum < 2 && check == sum) || (sum >= 2 && check + sum == 11);
}

function sendToMonitoringSystem(ticketValueforLog, deviceCodeForLog, State) {
    let options = {
        uri: monitoringUrl,
        method: "POST",
        body: { 'ip': `${typeof DeviceIpToSrl[deviceCodeForLog] !== 'undefined' ? DeviceIpToSrl[deviceCodeForLog] : 0}`, 'state': `${STATE2MSTATE[State].toString()}`, 'value': `${ticketValueforLog}` },
        timeout: 1000,
        headers: { 'content-type': 'application/json' },
        json: true
    };
    request(options, function (err, result, body) {
        if (err) {
            console.log(err);
        }
    });
}

async function submitDeviceSubmission(ticketValueforLog, deviceCodeForLog, State) {
    try {
        let connection = await new sql.ConnectionPool(config).connect();
        let request = new sql.Request(connection);

        request.query(`INSERT INTO [portalTblDeviceSubmissions] ([SubmissionDateTicks],[DeviceSrl],[DeviceIP],[State],[Value])VALUES (${getCSharpTick()},${typeof DeviceCodeToSrl[deviceCodeForLog] !== 'undefined' ? DeviceCodeToSrl[deviceCodeForLog] : 0},N'${typeof DeviceIpToSrl[deviceCodeForLog] !== 'undefined' ? DeviceIpToSrl[deviceCodeForLog] : 0}',${STATE2MSTATE[State]},N'${ticketValueforLog}')`).then(result => {
            if (result.rowsAffected === 0) {
                console.log("Error inserting Device Submission Record!!!");
            }
        });
    } catch (exp) {
        console.log("sql err : " + exp);
    }
}

function pad_with_zeroes(number, length) {

    var my_string = '' + number;
    while (my_string.length < length) {
        my_string = '0' + my_string;
    }

    return my_string;

}