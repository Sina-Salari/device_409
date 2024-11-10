var net = require('net');
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
const { json } = require('body-parser');
const cryptr = new Cryptr('0^Madakto*Licence^0');
const cryptorEngine = require('./cryptor-engin');


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

readSettings(function (appSetting) {
    config = {
        remoteApi: appSetting.RemoteApi,
        logEnabled: appSetting.LogEnabled,
        serverIp: appSetting.ServerIp,
        serverPort: appSetting.ServerPort,
        apiKey: appSetting.ApiKey,
        placeId: cryptorEngine.decrypt("MadaktoCompany", appSetting.PlaceId)
    };
    //console.log(config);
    if (!fs.existsSync("appsettings.json")) {
        console.log("Can't find settings file.");
        return;
    }
});

checkMadaktoLicence(function (response) {
    //checkWithRemoteServer(0, "1111", 17, 02, null);
    if (response === "1") {
        console.log("======== Madakto licence error 1 ========");
        process.exit();
    }
});

let publicConfigs = JSON.parse(fs.readFileSync('appsettings.json', { encoding: "utf-8" }).trim());
server.listen(publicConfigs.ServerPort);
console.log("..... TCP server listening on %d", publicConfigs.ServerPort);

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

server.on("connection", function (socket) {
    console.info("Socket connection open for ip:" + socket.remoteAddress);
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
    logToFile("Server sent a message to (" + deviceIP + ") : " + result + deviceIP.substring(1, 3));
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
    let deviceIpAddressOrCode = boardMessage[1].trim().replace(/:/g, '.');
    //console.log("deviceIpAddressOrCode : " + deviceIpAddressOrCode);
    if (deviceIpAddressOrCode.indexOf('.') != -1) {
        logToFile("error deviceIpAddress : " + deviceIpAddressOrCode + " (" + (deviceIpAddressOrCode.indexOf('.') != -1 ? "is ip address" : "is device code") + ")");
        return callback("", deviceIpAddressOrCode, STATES.Inactive);
    }
    logToFile("ticketValue : " + ticketValue);
    logToFile("placeId : " + config.placeId);
    let defaultResult = boardMessage[0].substring(1, 2);
    logToFile("defaultResult : " + defaultResult);
    if (checkValidSoftware() <= 0) {
        console.log("======== Madakto licence error 2 ========");
        logToFile("======== Madakto licence error 2 ========");
        return callback("", deviceIpAddressOrCode, STATES.Inactive);
    }
    logToFile("======== checkWithRemoteServer");
    checkWithRemoteServer(defaultResult, ticketValue, config.placeId, deviceIpAddressOrCode, function (response1, response2, response3) {
        return callback(response1, response2, response3);
    });
}

function checkWithRemoteServer(defaultResult, ticketValue, placeId, deviceIpAddress, callback) {
    //let username = "MicaAPI";
    //let password = `Bk\_@YYN[?D4vUq,`;
    //console.log("Url : " + config.remoteApi + ticketValue);
    let options = {
        uri: config.remoteApi,
        method: "POST",
        //headers: { 'content-type': 'application/json', 'Authorization': `Basic TWljYUFQSTpCa1xfQFlZTls/RDR2VXEs` },
        headers: { 'content-type': 'application/json', 'Authorization': 'Basic ' + config.apiKey },
        body: { 'barcodeNumber': ticketValue, 'placeId': placeId },
        timeout: 15000,
        json: true
    };
    request(options, function (err, res, body) {
        if (err) {
            logToFile("2- Remote Connection Error/Timeout. Ticket value = " + ticketValue + " " + deviceIpAddress + " " + err);
            return callback("S", deviceIpAddress, STATES.Error);
        }
        //console.log("================" + JSON.stringify(body));
        //console.log("================" + res.body.success);
        if (typeof (body.success) !== 'undefined' && body.success) {
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
    let fetureDate = new Date("07/18/2024").toString();
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