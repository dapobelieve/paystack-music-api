// server.js
// where your node app starts

// init project
const express = require('express');
const app = express();
const axios = require('axios');
const moment = require('moment');
const helpers = require('./helpers');


// we've started you off with Express, 
// but feel free to use whatever libs or frameworks you'd like through `package.json`.

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));

// http://expressjs.com/en/starter/basic-routing.html
app.get('/', async function(request, response) {
  // response.sendFile(__dirname + '/views/index.html');
  try {
    const history = await helpers.fetchSlackHistory();
    const spotifyMessages = helpers.filterSpotifyMessages(history.messages);
    const tracks = helpers.filterSpotifyTracks(spotifyMessages);
    response.send(tracks);
  } catch (error) {
    response.send("An error occurred\n\n" + error); 
  }
});

// listen for requests :)
const listener = app.listen(process.env.PORT, function() {
  console.log('Your app is listening on port ' + listener.address().port);
});
