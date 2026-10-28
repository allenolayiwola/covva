import { test } from "node:test";
import assert from "node:assert/strict";
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS, VOICE_MIME_TYPES, VOICE_PURPOSES, appendTranscript, audioExtension, normaliseAudioMime, voiceAccuracyWarning } from "./voice.ts";

test("audio MIME types: codecs stripped, recorder aliases mapped, unsupported rejected", () => {
  assert.equal(normaliseAudioMime("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(normaliseAudioMime("video/webm"), "audio/webm");
  assert.equal(normaliseAudioMime("AUDIO/MP3"), "audio/mpeg");
  assert.equal(normaliseAudioMime("audio/m4a"), "audio/mp4");
  assert.equal(normaliseAudioMime("audio/wave"), "audio/wav");
  assert.equal(normaliseAudioMime("audio/x-m4a"), "audio/x-m4a");
  assert.equal(normaliseAudioMime("text/plain"), null);
  assert.equal(normaliseAudioMime(null), null);
  assert.equal(normaliseAudioMime(""), null);
  for (const m of VOICE_MIME_TYPES) assert.equal(normaliseAudioMime(m), m, `${m} round-trips`);
});

test("file extensions follow the MIME type", () => {
  assert.equal(audioExtension("audio/webm"), "webm");
  assert.equal(audioExtension("audio/ogg"), "ogg");
  assert.equal(audioExtension("audio/mpeg"), "mp3");
  assert.equal(audioExtension("audio/mp4"), "m4a");
  assert.equal(audioExtension("audio/x-m4a"), "m4a");
  assert.equal(audioExtension("audio/aac"), "aac");
  assert.equal(audioExtension("audio/wav"), "wav");
  assert.equal(audioExtension("audio/x-wav"), "wav");
});

test("the accuracy warning shows for every local language and never for English", () => {
  assert.equal(voiceAccuracyWarning("en"), false);
  assert.equal(voiceAccuracyWarning(null), false);
  assert.equal(voiceAccuracyWarning("tw"), true);
  assert.equal(voiceAccuracyWarning("gaa"), true);
  assert.equal(voiceAccuracyWarning("ee"), true);
  assert.equal(voiceAccuracyWarning("en", "tw"), true, "a detected local language wins over the hint");
  assert.equal(voiceAccuracyWarning("tw", "en-GB"), false, "detected English wins over a local hint");
});

test("transcripts append once, separated by a blank line", () => {
  assert.equal(appendTranscript("", "  Hello  "), "Hello");
  assert.equal(appendTranscript("Existing note", "Hello"), "Existing note\n\nHello");
  assert.equal(appendTranscript("Existing note\n\nHello", "Hello"), "Existing note\n\nHello", "never duplicated");
  assert.equal(appendTranscript("Existing", "   "), "Existing", "empty transcript leaves the text alone");
});

test("limits and purposes are the documented ones", () => {
  assert.equal(VOICE_MAX_SECONDS, 120);
  assert.equal(VOICE_MAX_BYTES, 10 * 1024 * 1024);
  assert.deepEqual([...VOICE_PURPOSES], ["quote_help", "claim_description", "support"]);
});
