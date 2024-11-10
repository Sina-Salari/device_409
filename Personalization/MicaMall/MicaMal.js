var net = require('net');
var port = process.env.PORT || 5453;
var server = net.createServer();;
var messageBuffers = {};
const request = require('request');
var fs = require("fs");
const sql = require('mssql');
var moment = require('moment-timezone');
const localeTZ = "Asia/Tehran";
var config = {}; var madaktoLicence = "";
var logStream = fs.createWriteStream("log.txt", { flags: 'a' });
var licenceStream = fs.createWriteStream("ml.txt", { flags: 'a' });
var APIToken = 0;
const Cryptr = require('cryptr');
const { json } = require('body-parser');
const cryptr = new Cryptr('0^Madakto*Licence^0');


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

server.listen(port);
console.log("..... TCP server listening on %d", port);

let sockets = [];

const broadcast = (msg) => {
    try {
        //console.log(JSON.stringify(sockets));
        sockets.forEach((client) => {
            if (!client.destroyed)
                client.write(msg, 'utf8', function (err) {
                    if (typeof err !== "undefined") {
                        console.log(err);
                    }
                });
        });
    }
    catch { }
    setTimeout(function () { console.log("-- in ping ..."); broadcast("R"); }, config.broadCastTimer);
};

//setTimeout(function () { broadcast("R"); }, config.broadCastTimer);

checkMadaktoLicence(function (response) {
    //let a = "3d6adb46 f277 4511 89eb 0b00e2c34bd4";
    //a = jamKardaneGandeGhahari(a, '-', 9);
    //a = jamKardaneGandeGhahari(a, '-', 14);
    //a = jamKardaneGandeGhahari(a, '-', 19);
    //a = jamKardaneGandeGhahari(a, '-', 24);
    //console.log(a);
    if (response === "1") {
        console.log("======== Madakto licence error 1 ========");
        process.exit();
    }
});

jamKardaneGandeGhahari = (main_string, ins_string, pos) => {
    return main_string.slice(0, pos - 1) + ins_string + main_string.slice(pos);
}

function checkMadaktoLicence(callback) {
    readLicence(function (response) {
        madaktoLicence = response;
        let mdld = new Date().toString();
        if (compareDateCompare(mdld, madaktoLicence) < 0) {
            callback("1");
        }
        else {
            fs.truncate('ml.txt', 0, function () {
                console.log('done....');
                logToFile('++++++ MD Licence File Generated....' + mdld);
                licenceStream.write(cryptr.encrypt(mdld));
                callback("0");
            });
        }
    });
}

readSettings(function (appSetting) {
    config = {
        remoteApi: appSetting.RemoteApi,
        logEnabled: appSetting.LogEnabled,
        hostIP: appSetting.HostIp,
        apiKey: appSetting.ApiKey,
        devicesList: appSetting.DevicesList,
        userName: appSetting.UserName,
        password: appSetting.Password,
        broadCastTimer: appSetting.BroadCastTimer
    };
    //console.log(config);
    if (!fs.existsSync("appsettings.json")) {
        console.log("Can't find settings file.");
        return;
    }

    //checkBarcodeValidity("*M123#192.168.0.1", function (response, deviceIP, state) {
    //    sendData(socket, response, deviceIP, state);
    //});
});

server.on("connection", function (socket) {
    console.info("Socket connection open for ip:" + socket.remoteAddress);
    messageBuffers[socket.remoteAddress] = "";
    sockets.push(socket);
    socket.on("ready", function (data) {

    });

    socket.on("data", async function (data) {

        if (data.indexOf("\n") > -1) {
            messageBuffers[socket.remoteAddress] += data;
            let boardMessage = messageBuffers[socket.remoteAddress].split('#');
            if (boardMessage[0].toString().trim() == "") {
                return;
            }
            logToFile("=======================================" + new Date());
            logToFile("Socket received a message : " + messageBuffers[socket.remoteAddress]);
            logToFile("boardMessage : " + boardMessage);
            messageBuffers[socket.remoteAddress] = "";
            if (boardMessage.length === 2 && boardMessage[0].toString().startsWith('*')) {
                await checkBarcodeValidity(boardMessage, function (response, deviceIP, state) {
                    sendData(socket, response, deviceIP, state);
                });
            }
            else {
                logToFile("Received message is invalid");
                logToFile("==============================================================================");
            }

        }
        else {
            //console.log("data from board : " + data);
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

function sendData(socket, result, deviceIP, state) {
    logToFile("Server sent a message to " + deviceIP.substring(1, 3) + " " + result);
    logToFile("==============================================================================");
    socket.write(result + deviceIP.substring(1, 3), 'utf8', function (err) {
        if (typeof err !== "undefined") {
            console.log(err);
            state = STATES.Error;
        }
    });
}

async function checkBarcodeValidity(boardMessage, callback) {
    let ticketValue = boardMessage[0].substring(2);
    //console.log("ticketValue1 : " + ticketValue);
    ticketValue = jamKardaneGandeGhahari(ticketValue, '-', 9);
    ticketValue = jamKardaneGandeGhahari(ticketValue, '-', 14);
    ticketValue = jamKardaneGandeGhahari(ticketValue, '-', 19);
    ticketValue = jamKardaneGandeGhahari(ticketValue, '-', 24);
    //console.log("ticketValue2 : " + ticketValue);
    let deviceIpAddressOrCode = boardMessage[1].trim().replace(/:/g, '.');
    //console.log("deviceIpAddressOrCode : " + deviceIpAddressOrCode);
    if (deviceIpAddressOrCode.indexOf('.') != -1) {
        logToFile("error deviceIpAddress : " + deviceIpAddressOrCode + " (" + (deviceIpAddressOrCode.indexOf('.') != -1 ? "is ip address" : "is device code") + ")");
        return callback("", deviceIpAddressOrCode, STATES.Inactive);
    }
    logToFile("ticketValue : " + ticketValue);
    logToFile("deviceCode : " + config.devicesList[parseInt(deviceIpAddressOrCode)]);
    let defaultResult = boardMessage[0  ].substring(1, 2);
    logToFile("defaultResult : " + defaultResult);
    if (checkValidSoftware() <= 0) {
        console.log("======== Madakto licence error 2 ========");
        logToFile("======== Madakto licence error 2 ========");
        return callback("", deviceIpAddressOrCode, STATES.Inactive);
    }
    logToFile("======== checkWithRemoteServer");
    checkWithRemoteServer(defaultResult, ticketValue, deviceIpAddressOrCode, function (response1, response2, response3) {
        return callback(response1, response2, response3);
    });
}

function checkWithRemoteServer(defaultResult, ticketValue, deviceIpAddress, callback) {
    //let username = "MicaAPI";
    //let password = `Bk\_@YYN[?D4vUq,`;
    //console.log("==============================================");
    //console.log("Url : " + config.remoteApi + "ticket-tear");
    //console.log("APIToken : " + APIToken);
    //if (APIToken == 0) {
    //    await getTokenForTicketAPI();
    //}
    //console.log("+++++++++++++++++++++++++++++++++++++++++++++++");
    let options = {
        uri: config.remoteApi + "ticket-tear",
        method: "POST",
        headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${APIToken}` },
        //headers: { 'content-type': 'application/json', 'Authorization': 'Basic ' + config.authentication },
        body: { 'ticket': ticketValue },
        timeout: 15000,
        json: true
    };
    request(options, function (err, res, body) {
        if (err) {
            logToFile("2- Remote Connection Error/Timeout. Ticket value = " + ticketValue + " " + deviceIpAddress + " " + err);
            return callback("S", deviceIpAddress, STATES.Error);
        }
        console.log("================" + JSON.stringify(res));
        //console.log("================" + res.body.auth_err);
        if (typeof (body.auth_err) !== 'undefined'/* && body.auth_err === "forbidden"*/) {
            getTokenForTicketAPI(defaultResult, ticketValue, deviceIpAddress, function (response1) {
                if (response1 === "1")
                    checkWithRemoteServer(defaultResult, ticketValue, deviceIpAddress, function (response1, response2, response3) {
                        return callback(response1, response2, response3);
                    });
                else {
                    console.log("///////////////////END!!!");
                    return;
                }
            });
        }
        else if (typeof (body.e) !== 'undefined' && body.e != "invalid ticket") {
            logToFile("2- Door opening. Ticket value = " + ticketValue + " " + deviceIpAddress);
            return callback(defaultResult, deviceIpAddress, STATES.Open);
        }
        else {
            logToFile("2- API result body = " + JSON.stringify(body));
            logToFile("2- Invalid Ticket. Ticket value = " + ticketValue + " " + deviceIpAddress);
            return callback("S", deviceIpAddress, STATES.Error);;
        }

    });
}

async function getTokenForTicketAPI(defaultResult, ticketValue, deviceIpAddress, callback) {
    //console.log("Token Url : " + config.remoteApi + "try-login");
    let options = {
        uri: config.remoteApi + "try-login",
        method: "POST",
        headers: { 'content-type': 'application/json' },
        body: { 'uname': config.userName, 'pwd': config.password, 'token': true },
        timeout: 15000,
        json: true
    };
    request(options, function (err, res, body) {
        if (err) {
            logToFile("Remote Connection Error/Timeout. in getTokenForTicketAPI : " + err);
            return callback("0");
        }
        //console.log("****************" + JSON.stringify(res));
        if (res.body.res == 0) {
            console.log("UserName and Password is not valid!!!");
            logToFile("UserName and Password is not valid!!!. in getTokenForTicketAPI : ");
            return callback("0");
        }
        else {
            APIToken = res.body.access_token;
            return callback("1");
        }
    });
}

function readSettings(callback) {
    fs.readFile('appsettings.json', { encoding: "utf-8" }, (err, data) => {
        let settings = JSON.parse(data);
        return callback(settings);
    });
}

function readLicence(callback) {
    fs.readFile("ml.txt", function (err, data) {
        return callback(cryptr.decrypt(data));
    });
}

function checkValidSoftware() {
    let isValid = 1;
    let currMadaktoDate = new Date().toString();
    let fetureDate = new Date("05/11/2025").toString();
    let pastDate = madaktoLicence;
    if (compareDateCompare(currMadaktoDate, fetureDate) > 0) {
        fs.truncate('ml.txt', 0, function () {
            logToFile('****** MD Licence File Generated....' + currMadaktoDate);
            licenceStream.write(cryptr.encrypt(currMadaktoDate));
        });
        isValid = 0;
    }
    if (compareDateCompare(currMadaktoDate, pastDate) < 0) {
        isValid = 0;
    }
    return isValid;
}

function compareDateCompare(firstDate, secondDate) {

    let a = new Date(firstDate);
    let b = new Date(secondDate);

    let msDateFirst = Date.UTC(a.getFullYear(), a.getMonth() + 1, a.getDate());
    let msDateSecond = Date.UTC(b.getFullYear(), b.getMonth() + 1, b.getDate());

    if (parseFloat(msDateFirst) < parseFloat(msDateSecond))
        return -1;
    else if (parseFloat(msDateFirst) == parseFloat(msDateSecond))
        return 0;
    else if (parseFloat(msDateFirst) > parseFloat(msDateSecond))
        return 1;
    else
        return null;
}

async function logToFile(message) {
    if (typeof config.logEnabled === 'undefined')
        await new Promise(done => setTimeout(done, 2000));
    if (config.logEnabled == 0)
        return;
    else
        logStream.write(message + "\r\n");
}