var net = require('net');
//var port = process.env.PORT || 5453;
var server = net.createServer();;
var messageBuffers = {};
var fs = require("fs");
var Twise = true;

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


let publicConfigs = JSON.parse(fs.readFileSync('appsettings.json', { encoding: "utf-8" }).trim());
server.listen(publicConfigs.Port);
console.log("..... TCP server listening on %d", publicConfigs.Port);

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
    setTimeout(function () { console.log("-- in ping ..."); broadcast("R"); }, publicConfigs.BroadCastTimer);
};

//setTimeout(function () { console.log("-- in ping ..."); broadcast("R"); }, publicConfigs.BroadCastTimer);

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
            console.log("=======================================" + new Date());
            //console.log("Socket count : " + sockets.length);
            console.log("Socket received a message : " + messageBuffers[socket.remoteAddress]);
            console.log("boardMessage : " + boardMessage);
            console.log("boardMessage.length : " + boardMessage.length);
            console.log("boardMessage.start char : " + boardMessage[0].toString().trim().substring(0, 1));
            console.log("boardMessage.startsWith : " + boardMessage[0].toString().trim().startsWith('*'));
            messageBuffers[socket.remoteAddress] = "";
            if (boardMessage.length == 2 && boardMessage[0].toString().trim().startsWith('*')) {
                console.log("in checkBarcodeValidity");
                await checkBarcodeValidity(boardMessage, function (response, ticketValue, deviceIP, state) {
                    sendData(socket, response, ticketValue, deviceIP, state);
                });
            }
            else {
                console.log("Received message is invalid :(");
                console.log("==============================================================================");
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

    //sendData(socket, "S", "", "10", STATES.Open);

});
server.on('error', function (error) {
    console.log('Error: ' + error);
});

function sendData(socket, result, ticketValue, deviceIP, state) {
    //result = new Date().getSeconds() > 30 ? result : "S";
    if (Twise)
        result = "M";
    else
        result = "S";
    //console.log("******************************************************"); 
    //console.log("Server sent a message to ----  " + deviceIP.toString().substring(1, 3)); 
    console.log("Server sent a messaasdsadge to " + deviceIP + " " + result + deviceIP.substring(1, 3));
    console.log("==============================================================================");
    //console.log(new Date().getSeconds());
    socket.write(result + deviceIP.substring(1, 3), 'utf8', function (err) {
        if (typeof err !== "undefined") {
            console.log(err);
            state = STATES.Error;
        }
    });
    Twise = !Twise;
}

async function checkBarcodeValidity(boardMessage, callback) {
    let receivedMessage = boardMessage[0].substring(2);
    console.log("receivedMessage : " + receivedMessage);
    let deviceIpAddressOrCode = boardMessage[1].trim().replace(/:/g, '.');
    console.log("deviceIpAddressOrCode : " + deviceIpAddressOrCode + " (" + (deviceIpAddressOrCode.indexOf('.') != -1 ? "is ip address" : "is device code") + ")");
    let defaultResult = boardMessage[0].substring(1, 2);
    console.log("defaultResult1 : " + defaultResult);
    callback(defaultResult, receivedMessage, deviceIpAddressOrCode, STATES.Open);
}


