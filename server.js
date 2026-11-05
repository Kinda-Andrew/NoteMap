// runs on node cause i dont really know php, sends the data between the two pages using the data file
// the node should be able to mostly carry over when we host 


var http = require('http');
var fs = require('fs');
var path = require('path');

var DATA_FOLDER = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_FOLDER)) fs.mkdirSync(DATA_FOLDER);

// The only three things the app saves.
var ALLOWED_KEYS = ['routes', 'status', 'caretakerNotes'];

var server = http.createServer(function (request, response) {

  var url = new URL(request.url, 'http://localhost');

  if (url.pathname === '/') return sendFile(response, 'index.html', 'text/html');

  if (url.pathname === '/app.js') return sendFile(response, 'app.js', 'text/javascript');


  if (url.pathname === '/data') return handleData(request, response, url);


  response.writeHead(404);
  response.end('Not found');


});


/*
we should probabaly have a document to keep track of the file situation cause if this gets moved into a folder 
and we have to navigate through we are going to have much more convuluted paths 
*/
function sendFile(response, fileName, type) {
  response.writeHead(200, { 'Content-Type': type });
  response.end(fs.readFileSync(path.join(__dirname, fileName)));

}

function handleData(request, response, url) {
  // i connected the pairing code to the file name so it saves each route as a json file and then we can call that json file
  var code = url.searchParams.get('code') || '';

  if (!/^[a-z0-9]{6,40}$/.test(code)) return sendJson(response, 400, { error: 'bad code' });

  var file = path.join(DATA_FOLDER, code + '.json');

  // normal GET request for pre existing file data so it can have like memory for users 
  if (request.method === 'GET') return sendJson(response, 200, readFile(file));

  // saveing it to the file
  var body = '';
  request.on('data', function (piece) { body += piece; });

  request.on('end', function () {

    var message = JSON.parse(body);
    if (ALLOWED_KEYS.indexOf(message.key) === -1) return sendJson(response, 400, { error: 'bad key' });

    var saved = readFile(file);  
    saved[message.key] = message.value;  

    fs.writeFileSync(file, JSON.stringify(saved));

    sendJson(response, 200, { ok: true });
  });
}

function readFile(file) {
  if (!fs.existsSync(file)) return {};

  return JSON.parse(fs.readFileSync(file, 'utf8'));

}

function sendJson(response, status, object) {
  response.writeHead(status, { 'Content-Type': 'application/json' });

  response.end(JSON.stringify(object));

}

// i use 8000 cause i have other programs that use 3000-6000 but ik most people prefer 3000 so if you guys
// want to switch this thats fine
server.listen(8000, function () {
  console.log('Running at http://localhost:8000');

});
