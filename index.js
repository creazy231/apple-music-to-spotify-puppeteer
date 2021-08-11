require('dotenv').config();
const _ = require('lodash');
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const cliProgress = require('cli-progress');
const ora = require('ora');

const config = {
	APPLE_PLAYLIST_URL: process.env.APPLE_PLAYLIST_URL,
	OAUTH_TOKEN: process.env.OAUTH_TOKEN,
	PLAYLIST_ID: process.env.PLAYLIST_ID,
	MARKET: process.env.MARKET,
};

(async () => {
	const spinner = ora('Fetching Songs from Apple Playlist').start();
	const browser = await puppeteer.launch({
		// headless: false
	});
	const page = await browser.newPage();
	await page.goto(config.APPLE_PLAYLIST_URL);
	await page.setViewport({
		width: 1200,
		height: 800
	});

	await page.waitForSelector('.page-container');

	await autoScroll(page);

	let songs = await page.evaluate(() => {
		let data = [];
		const elements = document.querySelectorAll('.songs-list-row--song');
		for (const element of elements) {
			const title = element.querySelector('.songs-list-row__song-name').textContent;
			const artist = element.querySelector('.songs-list-row__link').textContent;
			data.push({
				title,
				artist,
			});
		}
		return data;
	});

	await browser.close();

	spinner.succeed();

	// GET SPOTIFY
	const progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
	progress.start(songs.length, 0);
	for (let [index, song] of songs.entries()) {
		try {
			const {data} = await axios.get(`https://api.spotify.com/v1/search`, {
				headers: {
					'Authorization': `Bearer ${config.OAUTH_TOKEN}`
				},
				params: {
					q: `${song.title.replace(/ *\([^)]*\) */g, "")} ${song.artist}`,
					type: 'track',
				}
			});
			song.url = data.tracks?.items[0]?.external_urls.spotify;
			song.uri = data.tracks?.items[0]?.uri;
			await new Promise(r => setTimeout(r, 100));
			progress.update(index + 1);
		} catch (e) {
			console.log(e);
		}
	}

	await fs.writeFileSync('songs.json', JSON.stringify(songs));

	progress.stop();
	console.log(`✔ ${songs.length} Songs fetched`);

	// GET PLAYLIST
	let playlistItems = [];
	let check = true;
	while (check) {
		const {data: playlist} = await axios.get(`https://api.spotify.com/v1/playlists/${config.PLAYLIST_ID}/tracks`, {
			headers: {
				'Authorization': `Bearer ${config.OAUTH_TOKEN}`
			},
			params: {
				playlist_id: config.PLAYLIST_ID,
				market: config.MARKET,
				offset: playlistItems.length,
			}
		});
		if (playlist.items.length === 0) {
			check = false;
		}
		playlistItems = [...playlistItems, ...playlist.items];
	}

	console.log(`✔ ${playlistItems.length} Songs deleted from Playlist`);

	let tracksToRemoveChunk = [];
	for (const item of playlistItems) {
		tracksToRemoveChunk.push({
			uri: item.track.uri,
		});
	}

	tracksToRemoveChunk = tracksToRemoveChunk.chunk(50);

	// DELETE FROM PLAYLIST
	for (const tracksToRemove of tracksToRemoveChunk) {
		await axios.delete(`https://api.spotify.com/v1/playlists/${config.PLAYLIST_ID}/tracks`, {
			data: {
				tracks: tracksToRemove,
			},
			headers: {
				'Authorization': `Bearer ${config.OAUTH_TOKEN}`
			},
			params: {
				playlist_id: config.PLAYLIST_ID,
			}
		});
	}


	// ADD SONGS TO PLAYLIST
	let songsChunk = songs.map(s => {
		return s.uri;
	});

	songsChunk = _.compact(songsChunk);
	const songsToAddCount = songsChunk.length;
	songsChunk = songsChunk.chunk(50);

	for (const songsChunkElement of songsChunk) {
		await fs.writeFileSync('test.json', JSON.stringify({
			uris: songsChunkElement
		}));
		await axios.post(`https://api.spotify.com/v1/playlists/${config.PLAYLIST_ID}/tracks`, {
			uris: songsChunkElement,
		}, {
			headers: {
				'Authorization': `Bearer ${config.OAUTH_TOKEN}`
			},
			params: {
				playlist_id: config.PLAYLIST_ID,
			}
		}).catch(e => {
			console.log(e);
		});
	}

	console.log(`✔ ${songsToAddCount} Songs added to Playlist`);
})();

async function autoScroll(page) {
	await page.evaluate(async () => {
		const pageContainer = document.querySelector('.page-container');
		await new Promise((resolve, reject) => {
			var totalHeight = 0;
			var distance = 500;
			var timer = setInterval(async () => {
				var scrollHeight = pageContainer.scrollHeight;
				pageContainer.scrollBy(0, distance);
				totalHeight += distance;

				if (totalHeight >= scrollHeight) {
					clearInterval(timer);
					resolve();
				}
			}, 1000);
		});
	});
}

Object.defineProperty(Array.prototype, 'chunk', {
	value: function(chunkSize) {
		var array = this;
		return [].concat.apply([],
			array.map(function(elem, i) {
				return i % chunkSize ? [] : [array.slice(i, i + chunkSize)];
			})
		);
	}
});
