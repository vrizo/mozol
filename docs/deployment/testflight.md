TestFlight

Agents upload iOS builds to TestFlight with scripts/testflight.sh. It writes a run folder with testflight.log, archive.log and export.log. It refuses to run with uncommitted changes in ios/, unless `--allow-dirty` is given (only for an upload Vitalii asked for).

- App: bundle id net.vrizo.mozol, Apple team 5X3V5CCN2N, App Store Connect app "MOZOL".
- Signing: automatic, through an App Store Connect API key. xcodebuild gets the key with `-allowProvisioningUpdates -authenticationKeyPath/-authenticationKeyID/-authenticationKeyIssuerID`, so it can create the App ID, the profiles and a cloud-managed distribution certificate itself.
- Key: the file ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8, outside the repository. .env holds ASC_KEY_ID and ASC_ISSUER_ID. The key needs the Admin role.
- Version: MARKETING_VERSION from ios/project.yml. Build number: the UTC time of the upload, YYYYMMDDHHMM, so every upload is unique.
- Steps: xcodegen, MozolCore tests, archive (Release) into ios/.build-dd/archives/, export with destination "upload". The build appears in App Store Connect after Apple processes it, usually in 5 to 30 minutes.
- APNs: TestFlight builds use the production APNs environment. Debug builds on the simulator use development.
- The app declares no non-exempt encryption (ITSAppUsesNonExemptEncryption = NO), so an upload asks no export compliance question.

The App ID net.vrizo.mozol (with Push Notifications) and the App Store Connect app record "MOZOL" (SKU mozol) exist since 2026-10-24. The internal TestFlight group "Internal" has access to all builds; Vitalii is its tester.

Push checks on the installed build: ../ios/push-testing.md.
