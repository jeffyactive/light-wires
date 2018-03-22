/**
 * Copyright Jeffrey Dungen 2018
 * Built on the reelyActive platform
 */


const socketioClient = require('socket.io-client');
const config = require('./config');


const PARETO_URL = 'https://pareto.reelyactive.com';


var sessions = {};
var receivers = {};


// Initialise the observed receivers
for(var cReceiver = 0; cReceiver < config.RECEIVERS.length; cReceiver++) {
  receivers[config.RECEIVERS[cReceiver]] = {
    totalSessionDuration: 0,
    presences: 0
  };
}


// Connect to the Pareto WebSocket and handle events
process.env.PARETO_TOKEN = config.PARETO_TOKEN;
var socket = socketioClient(PARETO_URL,
                            { query: { token: config.PARETO_TOKEN } });
socket.on('appearance', handleEvent);
socket.on('displacement', handleEvent);
socket.on('disappearance', handleEvent);


// Handle real-time events
function handleEvent(event) {
  var isLikelyPerson = ((event.isPerson === 'yes') ||
                        (event.isPerson === 'possibly'));
  var isObservedReceiver = receivers.hasOwnProperty(event.receiverId);

  if(isLikelyPerson && isObservedReceiver) {
    updateSession(event, function(receiverId, duration) {
      receivers[receiverId].totalSessionDuration += duration;
    });
  }
}


// Update the session for the given event
function updateSession(event, callback) {
  var duration = 0;
  var receiverId = event.receiverId;

  if(sessions.hasOwnProperty(event.deviceId)) {
    duration = event.sessionDuration - 
               sessions[event.deviceId].lastSessionDuration;
    receiverId = sessions[event.deviceId].lastReceiverId;
  }

  sessions[event.deviceId] = {
    lastSessionDuration: event.sessionDuration,
    lastEventTime: event.time,
    lastReceiverId: event.receiverId
  };

  return callback(receiverId, duration);
}


// Periodically update presences
function updatePresences() {
  var timeoutTime = new Date().getTime() - config.SESSION_TIMEOUT_MILLISECONDS;

  for(receiverId in receivers) {
    receivers[receiverId].presences = 0;
  }

  for(sessionId in sessions) {
    var session = sessions[sessionId];

    if(session.lastEventTime < timeoutTime) {
      delete session;
    }
    else if(receivers.hasOwnProperty(session.lastReceiverId)) {
      receivers[session.lastReceiverId].presences++;
    }
  }
}
setInterval(updatePresences, config.UPDATE_INTERVAL_MILLISECONDS);


socket.on('connect', function(){
  console.log('socket.io connected to', PARETO_URL);
});

socket.on('disconnect', function(){
  console.log('socket.io disconnected from', PARETO_URL);
});
