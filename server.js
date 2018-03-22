/**
 * Copyright Jeffrey Dungen 2018
 * Built on the reelyActive platform
 */


const socketioClient = require('socket.io-client');
const hueApi = require('node-hue-api');
const config = require('./config');


const PARETO_URL = 'https://pareto.reelyactive.com';


var sessions = {};
var receivers = {};
var lights = {};
var minTotalSessionDuration = 0;
var maxTotalSessionDuration = 0;


// Initialise the observed receivers
for(var cReceiver = 0; cReceiver < config.RECEIVERS.length; cReceiver++) {
  receivers[config.RECEIVERS[cReceiver]] = {
    totalSessionDuration: 0,
    presences: 0
  };
}


// Initialise the connected lights and begin "breathing"
for(var cLight = 0; cLight < config.LIGHTS.length; cLight++) {
  var lightId = config.LIGHTS[cLight];
  lights[lightId] = { idle: true };
  breathing(lightId, true);
}


// Connect to the Hue bridge
var hue = new hueApi.HueApi(config.HUE_BRIDGE_IP, config.HUE_BRIDGE_USERNAME);
hue.lights().then(function(lights) {
  console.log('Connected to Hue bridge with', lights.lights.length, 'lights');
});


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

  minTotalSessionDuration = Number.MAX_SAFE_INTEGER;
  maxTotalSessionDuration = 0;

  for(receiverId in receivers) {
    receivers[receiverId].presences = 0;
    if(receivers[receiverId].totalSessionDuration < minTotalSessionDuration) {
      minTotalSessionDuration = receivers[receiverId].totalSessionDuration;
    }
    if(receivers[receiverId].totalSessionDuration > maxTotalSessionDuration) {
      maxTotalSessionDuration = receivers[receiverId].totalSessionDuration;
    } 
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


// Breathe in or out then call this function again after a timeout
function breathing(lightId, breatheIn) {
  var receiverId = config.RECEIVERS[config.LIGHTS.indexOf(lightId)];
  var receiver = receivers[receiverId];

  var b = 1;
  if(breatheIn) {
    b = 255;
  }

  var h;
  if(receiver.totalSessionDuration >= maxTotalSessionDuration) {
    h = config.MAX_HUE_VALUE;
  }
  else if(receiver.totalSessionDuration <= minTotalSessionDuration) {
    h = config.MIN_HUE_VALUE;
  }
  else {
    h = Math.round(((receiver.totalSessionDuration - minTotalSessionDuration) /
                    (1 + maxTotalSessionDuration - minTotalSessionDuration)) *
         (config.MAX_HUE_VALUE - config.MIN_HUE_VALUE)) + config.MIN_HUE_VALUE;
  }
  h += Math.round((Math.random() * 40) - 20);

  var presences = receiver.presences;
  var divisor = Math.max(1, Math.log(presences));
  var transition = Math.round(config.BREATHING_BASE_MILLISECONDS / divisor);

  var state = { bri: b, hue: h, sat: 255, transition: transition - 40 };
  setLightState(lightId, state);

  setTimeout(breathing, transition, lightId, !breatheIn);
}


// Set the state of the given light
function setLightState(id, state) {
  var makeIdle = function() {
    lights[id].idle = true;
  }

  var handleError = function(err) {
    lights[id].idle = true;
    console.log('Hue error:', err.message);
  }

  if(hue && lights.hasOwnProperty(id) && (lights[id].idle === true)) {
    lights[id].idle = false;
    var lightState = hueApi.lightState.create().hue(state.hue)
                                               .bri(state.bri)
                                               .sat(state.sat)
                                               .transition(state.transition || 0);
    hue.setLightState(id, lightState.on())
       .then(makeIdle)
       .fail(handleError)
       .done();
  }
};


socket.on('connect', function(){
  console.log('socket.io connected to', PARETO_URL);
});

socket.on('disconnect', function(){
  console.log('socket.io disconnected from', PARETO_URL);
});
