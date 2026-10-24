Testing silent pushes on a device

Silent pushes are checked on a real iPhone with a TestFlight build. The simulator does not deliver their payload (testing.md).

APNs key

- One team-scoped APNs auth key, shared with nobardak: key id in APNS_KEY_ID, team id in APNS_TEAM_ID, the .p8 file base64 in one line in APNS_PRIVATE_KEY_BASE64, all in .env.
- The worker gets the same three values as secrets when it sends pushes.

Steps

1. Install the build from TestFlight, sign in, finish the Permissions screen.
2. Settings, Push: copy the device token.
3. Keep the app open. Send the test push: `scripts/apns-push.mjs <device token> '{"mozol":{"v":1,"type":"test"}}'`. TestFlight builds use production APNs, the default. A Debug build installed from Xcode uses `--sandbox`.
4. Settings, Push: "Last Test Push" shows the time. A deliveries push (`'{"mozol":{"v":1,"type":"deliveries","pending":1}}'`) makes the app claim at once; the Placed screen shows the result.

How iOS delivers silent pushes

- The push type is `background`, priority 5, topic net.vrizo.mozol.
- With the app open, delivery is immediate.
- With the app in the background, iOS decides when to wake it. It delivers a few per hour at most and may hold them back in Low Power Mode.
- After the user swipes the app away in the app switcher, iOS delivers no silent pushes until the app is opened again.
- APNs keeps only the last undelivered push per device.
