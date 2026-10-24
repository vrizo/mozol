#!/usr/bin/env node
//
// jamie-export.mjs — fetch the newest meetings through the Jamie API (personal key JAMIE_API_KEY
// in .env) and write each one as a meeting.completed webhook body (docs/backend/sources/jamie.md).
//
//   scripts/jamie-export.mjs --out <folder> [--limit 30]
//
// One file per meeting: <folder>/<meeting id>.json. The bodies hold real calls of real people:
// keep the folder out of git (local/ is ignored).
//
// The API sends the transcript as one Markdown string ("Name", "###### mm:ss - mm:ss", text);
// the webhook sends a list without times. A speaker name maps to the participant with that name;
// "Speaker -1" maps to speakerId "-1". metadata.created is not in the API: the end of the meeting
// stands in for it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://beta-api.meetjamie.ai/v1/me";
const UNASSIGNED = "Speaker -1";
const fail = (message) => {
  console.error(`[jamie-export] ERROR: ${message}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const out = option("--out");
const limit = Number(option("--limit") ?? 30);
if (!out) fail("--out <folder> is required.");
if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("--limit must be 1..100.");

const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
const apiKey = readFileSync(envFile, "utf8")
  .split("\n")
  .find((line) => line.startsWith("JAMIE_API_KEY="))
  ?.slice("JAMIE_API_KEY=".length)
  .trim();
if (!apiKey) fail("JAMIE_API_KEY not set in .env.");

async function call(procedure, input) {
  const url = `${API}/${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const response = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (!response.ok) fail(`${procedure} answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return (await response.json()).result.data.json;
}

// "Name\n\n###### 00:10 - 00:11\n\ntext\n\n" repeated; the whole string must parse.
function turnsOf(meeting) {
  const header = /^([^\n]+)\n\n###### [0-9:]+ - [0-9:]+\n\n/gm;
  const heads = [...meeting.transcript.matchAll(header)];
  if (meeting.transcript.trim() !== "" && heads[0]?.index !== 0) {
    fail(`${meeting.id}: the transcript does not start with a speaker header.`);
  }
  return heads.map((head, i) => ({
    name: head[1],
    text: meeting.transcript.slice(head.index + head[0].length, heads[i + 1]?.index).trim(),
  }));
}

function toWebhookBody(meeting) {
  const idByName = new Map(meeting.participants.map((p) => [p.name, p.id]));
  if (idByName.size !== meeting.participants.length) fail(`${meeting.id}: two participants share a name.`);
  const transcript = turnsOf(meeting).map(({ name, text }) => {
    const speakerId = name === UNASSIGNED ? "-1" : idByName.get(name);
    if (speakerId === undefined) fail(`${meeting.id}: speaker "${name}" is not a participant.`);
    return { speakerId, speakerName: name, text };
  });
  return {
    metadata: {
      id: meeting.id,
      event: "meeting.completed",
      created: Math.floor(Date.parse(meeting.endTime ?? meeting.startTime) / 1000),
    },
    data: {
      title: meeting.title,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      user: { id: meeting.user.id, email: meeting.user.email },
      summary: meeting.summary,
      transcript,
      participants: meeting.participants.map((p) => ({ id: p.id, name: p.name, email: p.email })),
      event: meeting.event,
      tasks: meeting.tasks,
      tags: meeting.tags,
    },
  };
}

const { meetings } = await call("meetings.list", { limit });
mkdirSync(out, { recursive: true });
for (const { id } of meetings) {
  const body = toWebhookBody(await call("meetings.get", { meetingId: id }));
  writeFileSync(join(out, `${id}.json`), JSON.stringify(body));
  console.log(`${id}  ${body.data.transcript.length} turns  ${body.data.title}`);
}
console.log(`[jamie-export] ${meetings.length} meetings in ${out}`);
