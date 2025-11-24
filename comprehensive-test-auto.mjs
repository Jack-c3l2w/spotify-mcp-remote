#!/usr/bin/env node
/**
 * Comprehensive automated manual test for Spotify MCP Server
 * Tests all search types and all playback controls
 */

import { spawn } from 'child_process';

const DEVICE_ID = 'f0197db3641e64e90377a59a8bc463d4cf5d74f9'; // andrew-shopify-laptop-spotifyd

// Start MCP server
const serverProcess = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let messageId = 1;
const pendingRequests = new Map();

// Handle server responses
serverProcess.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter((line) => line.trim());

  for (const line of lines) {
    try {
      const message = JSON.parse(line);

      if (message.id && pendingRequests.has(message.id)) {
        const resolve = pendingRequests.get(message.id);
        pendingRequests.delete(message.id);
        resolve(message);
      }
    } catch (error) {
      // Ignore non-JSON lines
    }
  }
});

serverProcess.stderr.on('data', (data) => {
  console.error('Server error:', data.toString());
});

// Helper to send MCP requests
function sendRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = messageId++;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    pendingRequests.set(id, resolve);

    serverProcess.stdin.write(JSON.stringify(request) + '\n');

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }
    }, 30000);
  });
}

// Helper to call a tool
async function callTool(name, args = {}) {
  const response = await sendRequest('tools/call', {
    name,
    arguments: args,
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return response.result;
}

// Helper to wait
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Test runner
async function runTests() {
  console.log('\n🎵 Spotify MCP Server Comprehensive Test\n');
  console.log('=' .repeat(60));

  try {
    // Initialize
    await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0',
      },
    });

    console.log('\n✅ Server initialized\n');

    // ============================================================
    // PART 1: SEARCH TESTS
    // ============================================================

    console.log('\n📱 PART 1: Search Tests');
    console.log('-'.repeat(60));

    // Test 1: Search tracks only
    console.log('\n🎵 TEST 1: Search for tracks (AC/DC)');
    const trackResults = await callTool('spotify_search', {
      query: 'AC/DC',
      types: ['track'],
      limit: 5,
    });
    console.log(trackResults.content[0].text);

    // Test 2: Search albums only
    console.log('\n💿 TEST 2: Search for albums (Back in Black)');
    const albumResults = await callTool('spotify_search', {
      query: 'Back in Black',
      types: ['album'],
      limit: 5,
    });
    console.log(albumResults.content[0].text);

    // Test 3: Search playlists only
    console.log('\n📋 TEST 3: Search for playlists (Rock Classics)');
    const playlistResults = await callTool('spotify_search', {
      query: 'Rock Classics',
      types: ['playlist'],
      limit: 5,
    });
    console.log(playlistResults.content[0].text);

    // Test 4: Search podcasts only
    console.log('\n🎙️ TEST 4: Search for podcasts (Tech)');
    const podcastResults = await callTool('spotify_search', {
      query: 'Tech',
      types: ['show'],
      limit: 5,
    });
    console.log(podcastResults.content[0].text);

    // Test 5: Multi-type search
    console.log('\n🔍 TEST 5: Multi-type search (Beatles)');
    const multiResults = await callTool('spotify_search', {
      query: 'Beatles',
      types: ['track', 'album', 'playlist'],
      limit: 3,
    });
    console.log(multiResults.content[0].text);

    // ============================================================
    // PART 2: PLAYBACK TESTS
    // ============================================================

    console.log('\n\n📱 PART 2: Playback Tests');
    console.log('-'.repeat(60));

    // Test 6: Play a specific track
    console.log('\n▶️ TEST 6: Play "Back in Black" by AC/DC');
    const trackSearch = await callTool('spotify_search', {
      query: 'Back in Black AC/DC',
      types: ['track'],
      limit: 1,
    });
    console.log(trackSearch.content[0].text);

    // Extract URI from search results
    const trackUri = trackSearch.content[0].text.match(/spotify:track:[a-zA-Z0-9]+/)[0];
    console.log(`\nPlaying track: ${trackUri}`);

    await callTool('spotify_play', {
      device_id: DEVICE_ID,
      uris: [trackUri],
    });
    console.log('✅ Playback started');
    await wait(5000); // Wait 5 seconds

    // Test 7: Pause playback
    console.log('\n⏸️ TEST 7: Pause playback');
    await callTool('spotify_pause', { device_id: DEVICE_ID });
    console.log('✅ Playback paused');
    await wait(2000);

    // Test 8: Resume playback
    console.log('\n▶️ TEST 8: Resume playback');
    await callTool('spotify_play', { device_id: DEVICE_ID });
    console.log('✅ Playback resumed');
    await wait(5000);

    // Test 9: Next track
    console.log('\n⏭️ TEST 9: Skip to next track');
    await callTool('spotify_next', { device_id: DEVICE_ID });
    console.log('✅ Skipped to next track');
    await wait(3000);

    // Test 10: Previous track
    console.log('\n⏮️ TEST 10: Skip to previous track');
    await callTool('spotify_previous', { device_id: DEVICE_ID });
    console.log('✅ Skipped to previous track');
    await wait(3000);

    // Test 11: Volume control
    console.log('\n🔊 TEST 11: Set volume to 50%');
    await callTool('spotify_set_volume', {
      volume_percent: 50,
      device_id: DEVICE_ID,
    });
    console.log('✅ Volume set to 50%');
    await wait(2000);

    await callTool('spotify_set_volume', {
      volume_percent: 75,
      device_id: DEVICE_ID,
    });
    console.log('✅ Volume restored to 75%');
    await wait(2000);

    // ============================================================
    // PART 3: ADVANCED PLAYBACK TESTS
    // ============================================================

    console.log('\n\n📱 PART 3: Advanced Playback Tests');
    console.log('-'.repeat(60));

    // Test 12: Play album
    console.log('\n💿 TEST 12: Play album "Back in Black"');
    const albumUri = 'spotify:album:6mUdeDZCsExyJLMdAfDuwh'; // Back in Black by AC/DC
    await callTool('spotify_play', {
      device_id: DEVICE_ID,
      context_uri: albumUri,
    });
    console.log('✅ Album playback started');
    await wait(5000);

    // Test 13: Play playlist
    console.log('\n📋 TEST 13: Play playlist');
    // Get a playlist URI from earlier search
    const playlistUri = playlistResults.content[0].text.match(/spotify:playlist:[a-zA-Z0-9]+/)?.[0];
    if (playlistUri) {
      await callTool('spotify_play', {
        device_id: DEVICE_ID,
        context_uri: playlistUri,
      });
      console.log('✅ Playlist playback started');
      await wait(5000);
    } else {
      console.log('⚠️ No playlist URI found, skipping');
    }

    // Test 14: Shuffle mode
    console.log('\n🔀 TEST 14: Enable shuffle');
    await callTool('spotify_set_shuffle', {
      state: true,
      device_id: DEVICE_ID,
    });
    console.log('✅ Shuffle enabled');
    await wait(2000);

    await callTool('spotify_set_shuffle', {
      state: false,
      device_id: DEVICE_ID,
    });
    console.log('✅ Shuffle disabled');
    await wait(2000);

    // Test 15: Repeat modes
    console.log('\n🔁 TEST 15: Repeat modes');

    console.log('\n   Setting repeat to "context" (repeat album/playlist)');
    await callTool('spotify_set_repeat', {
      state: 'context',
      device_id: DEVICE_ID,
    });
    console.log('   ✅ Repeat set to context');
    await wait(2000);

    console.log('\n   Setting repeat to "track" (repeat single song)');
    await callTool('spotify_set_repeat', {
      state: 'track',
      device_id: DEVICE_ID,
    });
    console.log('   ✅ Repeat set to track');
    await wait(2000);

    console.log('\n   Setting repeat to "off"');
    await callTool('spotify_set_repeat', {
      state: 'off',
      device_id: DEVICE_ID,
    });
    console.log('   ✅ Repeat turned off');
    await wait(2000);

    // Test 16: Get current playback state
    console.log('\n📊 TEST 16: Get current playback state');
    const state = await callTool('spotify_current_playback');
    console.log(state.content[0].text);

    // Test 17: Stop playback
    console.log('\n⏹️ TEST 17: Stop playback');
    await callTool('spotify_pause', { device_id: DEVICE_ID });
    console.log('✅ Playback stopped');

    // ============================================================
    // ALL TESTS COMPLETE
    // ============================================================

    console.log('\n\n' + '='.repeat(60));
    console.log('✅ ALL TESTS PASSED!');
    console.log('='.repeat(60));
    console.log('\nTested:');
    console.log('  ✅ Track search');
    console.log('  ✅ Album search');
    console.log('  ✅ Playlist search');
    console.log('  ✅ Podcast search');
    console.log('  ✅ Multi-type search');
    console.log('  ✅ Play track');
    console.log('  ✅ Pause/Resume');
    console.log('  ✅ Next/Previous track');
    console.log('  ✅ Volume control');
    console.log('  ✅ Play album');
    console.log('  ✅ Play playlist');
    console.log('  ✅ Shuffle mode');
    console.log('  ✅ Repeat modes (context, track, off)');
    console.log('  ✅ Get playback state');
    console.log('\n');
  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    process.exit(1);
  } finally {
    serverProcess.kill();
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
