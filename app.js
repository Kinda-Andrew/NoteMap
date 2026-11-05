// these are the variable i think we would need to change quickly when testing so i put them at the top
var OFF_ROUTE_METRES = 60;
var IDLE_SECONDS = 15 * 60;  //decrease this one way more when testing
var IDLE_RADIUS = 25;
var UPDATE_EVERY_MS = 10000; //update timer

// this is all stuff thats functionally gonna be saved by our data file
var role = '';  // 'commuter' or 'caretaker'
var code = '';

var map;
var data = {}; // this is for the routes, status, caretakerNotes that have to be sent through the server


// commuter only
var myPosition = null;
var myMarker = null;
var currentRoute = null; 
var routeStarted = false;
var lastMoved = { position: null, time: Date.now() };// where and when the commuter last moved

// caretaker and commuter
var routeLine = null; 


// first 2 screens
function showScreen(id) {
  var  screens = document.querySelectorAll('.screen');
  for (var  i = 0; i < screens.length; i++)  screens[i].hidden = true;
  document.getElementById(id).hidden = false;
}
function chooseRole(chosen) {
  role = chosen;
  showScreen('screenCode') ;
}

// basic randomized code generator
function makeCode() {
  var letters = 'abcdefghijkmnpqrstuvwxyz23456789';
  var newCode = '';
  for (var i = 0; i < 10; i++) {
    newCode = newCode + letters[Math.floor(Math.random() * letters.length)];
  }
  document.getElementById('codeBox').value = newCode  ;
}

async function goNext() {
  code = document.getElementById('codeBox').value.trim().toLowerCase();
  if (!/^[a-z0-9]{6,40}$/.test(code)) {
    document.getElementById('codeError').textContent = 'Code must be 6+ letters or numbers.';
    return;
  }
  data = await loadData();//  running the fetch from the server

  if (role === 'commuter') {
    showScreen('screenCommuter');
    startCommuter();
  } else {
     showScreen('screenCaretaker');
    startCaretaker();
  }
}


// server functions and the json

async function loadData() {
   var reply = await fetch('/data?code=' + code);
  return await reply.json();
}

async function saveData(key, value) {
   data[key] = value;
  await fetch('/data?code=' + code, {
    method: 'POST',
    body: JSON.stringify({ key: key, value: value })
  });
}



// this is for making conversions cause the lat and lng are angles and they gotta be flattened
//its just used for the distance checks for being idle and for checking the commuter is on the actual route
// it is kinda prone to breaking if you change stuff in it
function toMetres(point, referenceLat) {
  return {
    x: point.lng * 111320 * Math.cos(referenceLat * Math.PI / 180) ,
    y: point.lat * 110540
  };
}
function metresBetween(a, b) {
  var p = toMetres(a, a.lat);
  var q = toMetres(b, a.lat);
  return Math.sqrt((p.x - q.x) * 
  (p.x - q.x) + 
  (p.y - q.y) * 
  (p.y - q.y));
}
function distanceToSegment(p, a, b) {
  var dx = b.x - a.x;
  var dy = b.y - a.y;

  var lengthSquared = dx * dx + dy * dy;

  var t = 0;
  if (lengthSquared > 0) {
    t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
  }
  var closestX = a.x + t * dx;
  var closestY = a.y + t * dy;

  return Math.sqrt((p.x - closestX) * 
  (p.x - closestX) + (p.y - closestY) 
  * (p.y - closestY));
}
function distanceFromRoute(position, path) {
  var p = toMetres(position, position.lat) ;
  var closest = Infinity;

  for (var i = 0; i < path.length - 1; i++) {
    var a = toMetres(path[i], position.lat);
    var b = toMetres(path[i + 1], position.lat);
    var d = distanceToSegment(p, a, b);
    if (d < closest) closest = d;
  }

  return closest;
}


//google maps stuff ----------------------------------------------------------------------------

function makeMap(elementId) {
  map = new google.maps.Map(document.getElementById(elementId), {
    center: { lat: 49.19, lng: -122.85 }, 
    zoom: 15 
    // its on surrey central rn
  });
}
function drawRoute(path) {
  if (routeLine) routeLine.setMap(null); 
  routeLine = new google.maps.Polyline({ map: map, path: path, strokeColor: '#15b548', strokeWeight: 5 });
  // need to decide on a colour and design pallete for the project 

  var bounds = new google.maps.LatLngBounds();
  for (var i = 0; i < path.length; i++) bounds.extend(path[i]);
  map.fitBounds(bounds);
}

function timeText(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

// Makes typed text safe to show on the page.
function safe(text) {
  var div = document.createElement('div') ;
  div.textContent = text;
  return div.innerHTML;
}
// -------------------------------------------------------------------------------------------------------------

//Commuter functions

function startCommuter() {
  makeMap('mapCommuter');
  myMarker = new google.maps.Marker({ map: map });

  // grab location
  navigator.geolocation.watchPosition(function (result) {
    myPosition = { lat: result.coords.latitude, lng: result.coords.longitude };
    myMarker.setPosition(myPosition);

    // starting the idle stop watch once the location gets set 
    if (lastMoved.position === null) {
      map.setCenter(myPosition);
      lastMoved = { position: myPosition, time: Date.now() };
    }



    // this resets the idle timer when theyve moved
    if (metresBetween(myPosition, lastMoved.position) > IDLE_RADIUS) {

      lastMoved = { position: myPosition, time: Date.now() };

    }

    document.getElementById('myStatus').textContent = 'Location found.';
  }, function () {

    document.getElementById('myStatus').textContent =
      'Allow location access';

  }, { enableHighAccuracy: true }); // this is to make it more specific


  // this makes sure to update every ten seconds - this is for the non fucntional requirements
  setInterval(everyTenSeconds, UPDATE_EVERY_MS);

  // gets routes
  if (data.routes && data.routes.length > 0) {
    currentRoute = data.routes[data.routes.length - 1];

    drawRoute(currentRoute.path);
  }
}

async function makeRoute() {
  if (!myPosition) 
    return alert('Try again');
  var destination = document.getElementById('destination').value.trim();
  if (!destination) 
    return alert('No destination entered');

  try {
    // the documentaion for routes is kinda wonky sometimes but this setup kept the routes fairly consistent so i kept it
    var library = await google.maps.importLibrary('routes');

    var answer = await library.Route.computeRoutes({
      origin: myPosition,
      destination: destination,
      travelMode: document.getElementById('mode').value,
      fields: ['path']

    });

    var points = answer.routes[0].path;
    var path = [];
    for (var i = 0; i < points.length; i++) {
      path.push({ lat: Number(points[i].lat), lng: Number(points[i].lng) });
      // this isnt modified at all before it saves on the data/.json file so its just like 500 lat lng pairs 
      // we could change this but functionality wise its fine its just like super unreadable
      // idk when we would ever need to like change that though
    }

    // save route
    //and send to caretaker
    currentRoute = {
      destination: destination,
      note: document.getElementById('routeNote').value,
      path: path,
      time: Date.now()
    };
    routeStarted = false;
    var allRoutes = data.routes || [];
    allRoutes.push(currentRoute);
    await saveData('routes', allRoutes);

    drawRoute(path);
    alert('Press Start Route');
  } catch (error) {
    console.log(error);
    alert('Routes API might be broken check your api key or if you enabled the routes API on your key before you tried it');
  }
}

function startRoute() {
  if (!currentRoute) return alert('Make a route');
  routeStarted = true;
  lastMoved = { position: myPosition, time: Date.now() };   // restart the idle stopwatch
  alert('Route started :)');
}

// Runs every 10 seconds on commuter device
async function everyTenSeconds() {
  if (!myPosition) return;

  var problems = [];
  var statusText = 'Not on a route';

  // this just makes sure the straying and idle checks are only checked when the person actually has a route active
  if (routeStarted) {
    if (distanceFromRoute(myPosition, currentRoute.path) > OFF_ROUTE_METRES) {
      problems.push('OFF ROUTE');
    }
    var secondsStill = (Date.now() - lastMoved.time) / 1000;
    if (secondsStill > IDLE_SECONDS) {
      problems.push('IDLE');

    }
    statusText = problems.length > 0 ? problems.join(' + ') : 'On route';

  }

 //warning general ui
  var warning = document.getElementById('warning');
  warning.hidden = problems.length === 0;
  warning.textContent = 'Warning: ' + problems.join(' + ') + '. Check your route.';

  // updates the caretaker
  await saveData('status', { lat: myPosition.lat, lng: myPosition.lng, text: statusText, time: Date.now() });


  // updates the commuter on caretaker notes
  var latest = await loadData();
  data.caretakerNotes = latest.caretakerNotes || [];
  showNotesForCommuter();
}


// i was thinking of putting this with the care taker functions but it was way simpler to call it when 
//the commuter updates the caretaker on info
function showNotesForCommuter() {
  var html = '';
  var notes = data.caretakerNotes || [];
  
  for (var i = 0; i < notes.length; i++) {
    html = html + '<div class="note">' + safe(notes[i].text) + '</div>';
  }

  document.getElementById('notesForCommuter').innerHTML = html || 'No notes';
}


// caretaker functions

var commuterMarker = null;

function startCaretaker() {
  makeMap('mapCaretaker');
  commuterMarker = new google.maps.Marker({ map: map, icon: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png' });
  refreshCaretaker();
  setInterval(refreshCaretaker, 5000); // check for data every 5 seconds
}

async function refreshCaretaker() {
  data = await loadData();
  if (data.status) {
    commuterMarker.setPosition({ lat: data.status.lat, lng: data.status.lng });
    document.getElementById('commuterStatus').textContent =
      'Status: ' + data.status.text + '  (updated ' + timeText(data.status.time) + ')';
  }



  //routes and notes
  var routes = data.routes || [];
  var html = '';
  for (var i = routes.length - 1; i >= 0; i--) {
    html = html + '<div class="note"><b>To: ' + safe(routes[i].destination) + '</b><br>' +
           'Note: ' + safe(routes[i].note || '(none)') + '<br>' + timeText(routes[i].time) + '</div>';
  }
  document.getElementById('routeList').innerHTML = html || 'No routes yet.';

  var newest = routes[routes.length - 1];
  if (newest && (!routeLine || routeLine.latestTime !== newest.time)) {
    drawRoute(newest.path);
    routeLine.latestTime = newest.time;
  }

  //caretaker visiblilty of their own notes 
  var notes = data.caretakerNotes || [];
  var noteHtml = '';
  for (var j = 0; j < notes.length; j++) {
    noteHtml = noteHtml + '<div class="note">' + safe(notes[j].text) + '</div>';
  }


  document.getElementById('caretakerNoteList').innerHTML = noteHtml;
}



async function addNote() {
  var box = document.getElementById('newNote');

  if (box.value.trim() === '') return;

  var notes = data.caretakerNotes || [];
  notes.push({ text: box.value.trim(), time: Date.now() });
  await saveData('caretakerNotes', notes);
  box.value = '';

  
  refreshCaretaker();
}
