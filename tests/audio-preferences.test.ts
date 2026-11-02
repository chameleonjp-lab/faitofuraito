import test from 'node:test';
import assert from 'node:assert/strict';
import { readAudioPreferences } from '../src/audio-preferences';
test('new audio settings start on while explicit off and zero survive reload', () => {
 assert.deepEqual(readAudioPreferences(null),{enabled:true,volume:1});
 assert.deepEqual(readAudioPreferences('{"enabled":false,"volume":0}'),{enabled:false,volume:0});
 assert.deepEqual(readAudioPreferences('{"enabled":true,"volume":0.4}'),{enabled:true,volume:0.4});
 assert.deepEqual(readAudioPreferences('{"enabled":"false","volume":-1}'),{enabled:true,volume:1});
 assert.deepEqual(readAudioPreferences('invalid'),{enabled:true,volume:1});
});
