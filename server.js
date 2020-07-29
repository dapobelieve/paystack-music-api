// server.js
// where your node app starts

// init project
const express = require('express');
const bodyParser = require('body-parser');
const moment = require('moment');

const app = express();
const path = require('path');
const dotenv = require('dotenv');
require('./db');

dotenv.config();

const slack = require('./helpers/slack');
const spotify = require('./helpers/spotify');
const color = require('./helpers/color');
const image = require('./helpers/image');

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get('/', async (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head></head>
      <body>
        <h1>Welcome to Paystack Music!</h1>
        <p>Visit <a href="/authorize">/authorize</a> to get started if you're not logged in already</p>
      </body>
    </html>
  `;
  res.send(html);
});

app.get('/authorize', async (req, res) => {
  const authURL = spotify.createAuthURL();
  const html = `
    <!DOCTYPE html>
    <html>
      <head></head>
      <body>
        <h1>Hello!</h1>
        <p>Please make sure you're logged into Spotify</p>
        <a target="_blank" href="${authURL}">Click here to authorize</a>
      </body>
    </html>
  `;
  res.send(html);
});

app.get('/callback', async (req, res) => {
  try {
    const { code } = req.query;
    await spotify.performAuthentication(code);

    const html = `
      <!DOCTYPE html>
      <html>
        <head></head>
        <body>
          <h1>All done!</h1>
          <p>Send a POST request to <a target="_blank" href="#">${process.env.APP_TRIGGER_URI}</a> with the parameters { year (yyyy), month (mm), day (dd) } to generate a playlist.</p>
          </br>
          <p>NB: Playlists are generated for the month <b>before</b> the date specified in your request params</p>
        </body>
      </html>
    `;
    res.send(html);
  } catch (error) {
    res.send(JSON.stringify(error));
  }
});

app.post('/trigger', async (req, res) => {
  try {
    await spotify.performAuthentication();

    const dateYear = req.body.year;
    const dateMonth = Number(req.body.month) < 10 ? `0${Number(req.body.month)}` : req.body.month;
    const dateDay = Number(req.body.day) < 10 ? `0${Number(req.body.day)}` : req.body.day;

    const date = `${dateYear}-${dateMonth}-${dateDay}`;
    const playlistMonth = moment(date).subtract(1, 'months');
    const playlistName = playlistMonth.format('MMMM YYYY');

    const history = await slack.fetchChannelHistory(playlistMonth);

    if (!(history.messages && history.messages.length)) {
      res.send('Could not find any messages. Please check the channel and try again.');
      return;
    }

    const spotifyMessages = slack.filterSpotifyMessages(history.messages);
    const tracks = slack.filterSpotifyTracks(spotifyMessages);
    const contributors = await slack.saveContributors(tracks);

    // create new playlist
    let playlist = await spotify.createPlaylist(playlistName);
    const playlistId = await spotify.savePlaylist(playlist, contributors);
    spotify.saveTracks(tracks, playlistId);

    // and songs to playlist
    const trackURIs = tracks.map((track) => `spotify:track:${track.id}`);

    // upload in batches of 99
    const batchSize = 99;
    for (let i = 0; i < trackURIs.length; i += batchSize) {
      const batch = trackURIs.slice(i, i + batchSize);
      // eslint-disable-next-line no-await-in-loop
      await spotify.addTracksToPlaylist(playlist.id, batch);
    }
    // get playlist cover art
    playlist = await spotify.getPlaylist(playlist.id);
    const coverImageUrl = playlist.images[0].url;

    // pick color from current cover art
    const dominantColor = await color.getBackgroundColorFromImage(coverImageUrl);

    // create new cover art
    const newCoverImage = await image.generateCoverImage({
      color: dominantColor,
      month: playlistMonth.format('MMMM'),
      year: playlistMonth.format('YYYY'),
    });

    // attach album art to playlist
    await spotify.setPlaylistCover(playlist.id, newCoverImage);

    // send playlist to slack
    await slack.sendMessage(playlist.external_urls.spotify);
    await slack.sendMessage(`There were ${history.messages.length} messages in the music channel for ${playlistMonth.format('MMMM')} ${playlistMonth.format('YYYY')}`);

    // finish
    res.send(`${playlistName} playlist, check spotify (or your Slack DMs if you're Kachi :))`);
  } catch (error) {
    const e = { message: error.message, stack: error.stack };
    await slack.sendMessage(JSON.stringify(e));
    res.send(JSON.stringify(e));
  }
});

app.get('/covers', (req, res) => {
  res.sendFile(path.join(`${__dirname}/views/covers.html`));
});

app.get('/track/audio-features', async (req, res) => {
  try {
    const { spotify_link: spotifyLink } = req.query;
    if (!spotifyLink) {
      return res.status(400).send({
        status: false,
        message: '"spotify_link" is required',
      });
    }
    if (!spotify.isSpotifyTrack(spotifyLink)) {
      return res.status(400).send({
        status: false,
        message: 'Spotify link is invalid',
      });
    }

    await spotify.performAuthentication();
    const spotifyID = spotify.getSpotifyIdFromURL(spotifyLink);
    const trackFeatures = await spotify.getAudioFeaturesForTrack(spotifyID);
    return res.status(200).send({
      status: true,
      data: trackFeatures,
    });
  } catch (err) {
    return res.status(500).send({ message: 'An error occurred' });
  }
});

app.post('/track/data', async (req, res) => {
  try {
    const { track_ids: ids } = req.body;
    if (!ids && !Array.isArray(ids)) {
      return res.status(400).send({
        status: false,
        message: '"track_ids" is required',
      });
    }

    const result = await spotify.performAuthentication();
    if (result && result.code === 401) {
      return res.status(401).send({ message: result.message });
    }

    const data = await spotify.getTrackData(ids);

    return res.status(200).send({
      status: true,
      data,
    });
  } catch (err) {
    return res.status(500).send({ message: 'An error occurred' });
  }
});

// eslint-disable-next-line no-unused-vars
app.post('/webhook', (req, res) => {

});

// listen for requests :)
const listener = app.listen(process.env.PORT, () => {
  console.log(`Your app is listening on port ${listener.address().port}`);
});
