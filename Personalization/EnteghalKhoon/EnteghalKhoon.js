var net = require('net');
var port = process.env.PORT || 5451;
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
var licenceIsValid = 0;
const Cryptr = require('cryptr');
const cryptr = new Cryptr('0^Madakto*Licence^0');


let Configs = {};
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

checkMadaktoLicence(function (response) {
    if (response === "1") {
        console.log("======== Madakto licence error 1 ========");
        process.exit();
    }
});

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

readSettings(function (response) {
    settings = String(response).split(';');
    config = {
        serverUrl1: settings[0],
        serverUrl2: settings[1],
        logEnabled: settings[2],
        hostIP: settings[3].replace("\r", "")
    };
    console.log(JSON.stringify(config));
    if (!fs.existsSync("appsettings.json")) {
        console.log("Can't find settings file.");
        return;
    }

    Configs = JSON.parse(fs.readFileSync('appsettings.json', { encoding: "utf-8" }).trim());
    //TODO سایر تنظیماات هم بیاد داخل همین جیسون کانفیگ

    //console.log(Configs.DevicesList[parseInt('001')]);
});

server.on("connection", function (socket) {
    console.info("Socket connection open for ip:" + socket.remoteAddress);
    messageBuffers[socket.remoteAddress] = "";

    socket.on("ready", function (data) {
        
    });

    socket.on("data", async function (data) {

        if (data.indexOf("\n") > -1) {
            messageBuffers[socket.remoteAddress] += data;
            logToFile("=======================================" + new Date());
            logToFile("Socket received a message : " + messageBuffers[socket.remoteAddress]);
            let boardMessage = messageBuffers[socket.remoteAddress].split('#');
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
    logToFile("Server sent a message to " + deviceIP + " " + result);
    logToFile("==============================================================================");
    socket.write(result, 'utf8', function (err) {
        if (typeof err !== "undefined") {
            console.log(err);
            state = STATES.Error;
        }
    });
}

async function checkBarcodeValidity(boardMessage, callback) {
    let ticketValue = boardMessage[0].substring(2);
    //logToFile("ticketValue : " + receivedMessage);
    let deviceIpAddressOrCode = boardMessage[1].trim().replace(/:/g, '.');    
    if (deviceIpAddressOrCode.indexOf('.') != -1) {
        logToFile("error deviceIpAddress : " + deviceIpAddressOrCode + " (" + (deviceIpAddressOrCode.indexOf('.') != -1 ? "is ip address" : "is device code") + ")");
        return callback("", deviceIpAddressOrCode, STATES.Inactive);
    }
    logToFile("deviceCode : " + deviceIpAddressOrCode);
    logToFile("deviceIpAddress : " + Configs.DevicesList[parseInt(deviceIpAddressOrCode)]);
    let defaultResult = boardMessage[0].substring(1, 2);
    logToFile("defaultResult : " + defaultResult);
    if (checkValidSoftware() <= 0) {
        console.log("======== Madakto licence error 2 ========");
        logToFile("======== Madakto licence error 2 ========");
        return callback("", deviceIpAddressOrCode, STATES.Inactive);
    }
    logToFile("======== checkWithRemoteServer");
    checkWithRemoteServer(defaultResult, ticketValue, Configs.DevicesList[parseInt(deviceIpAddressOrCode)], function (response1, response2, response3) {
        return callback(response1, response2, response3);
    });
}

function checkWithRemoteServer(defaultResult, ticketValue, deviceIpAddress, callback) {
    /*, 'Authorization': 'Basic ' + config.authentication*/
    let options = {
        uri: config.serverUrl1,
        method: "GET",
        qs: { 'id': ticketValue },
        headers: { 'content-type': 'application/json' },
        timeout: 15000,
        json: true
    };
    request(options, function (err, res, body) {
        if (err) {
            logToFile("1- Remote Connection Error/Timeout. Ticket value = " + ticketValue + " " + deviceIpAddress + " " + err.message);
            return callback("", deviceIpAddress, STATES.Error);
        }
        logToFile("serverUrl1 : " + JSON.stringify(body));
        if (body.Result == "true" || body.Result) {
            let options2 = {
                uri: config.serverUrl2,
                method: "POST",
                body: { 'id': `${ticketValue}`, 'ip': `${deviceIpAddress}` },
                headers: { 'content-type': 'application/json' },
                timeout: 15000,
                json: true
            };
            request(options2, function (err, res, body) {
                if (err) {
                    logToFile("2- Remote Connection Error/Timeout. Ticket value = " + ticketValue + " " + deviceIpAddress);
                    return callback("", deviceIpAddress, STATES.Error);
                }
                logToFile("serverUrl2 : " + JSON.stringify(body));
                if (body.Result == "true" || body.Result) {
                    return callback(defaultResult, deviceIpAddress, STATES.Error);;
                }
                else {
                    logToFile("2- API result body = " + JSON.stringify(body));
                    logToFile("2- Invalid Ticket. Ticket value = " + ticketValue + " " + deviceIpAddress);
                    return callback("", deviceIpAddress, STATES.Error);
                }
            });
        }
        else {
            logToFile("1- API result body = " + JSON.stringify(body));
            logToFile("1- Invalid Ticket. Ticket value = " + ticketValue + " " + deviceIpAddress);
            return callback("", deviceIpAddress, STATES.Error);
        }

    });


}

function readSettings(callback) {
    fs.readFile("Settings.txt", function (err, data) {
        return callback(data);
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
    let fetureDate = new Date("8/8/2022").toString();
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