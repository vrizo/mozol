#!/usr/bin/env python3
#
# ios-strings.py — rebuild ios/Mozol/Resources/Localizable.xcstrings from the
# strings the compiler extracted in the last Debug simulator build
# (*.stringsdata in ios/.build-dd). Run it after a build that changed UI copy.
# Previews and empty keys are left out. Keys with two or more arguments get an
# English value with positional arguments (%1$@, %2$@).

import glob
import json
import re
import sys

BUILD = "ios/.build-dd/Build/Intermediates.noindex/Mozol.build/Debug-iphonesimulator/Mozol.build/Objects-normal/arm64"
CATALOG = "ios/Mozol/Resources/Localizable.xcstrings"

files = sorted(glob.glob(f"{BUILD}/*.stringsdata"))
if not files:
    sys.exit(f"[ios-strings] ERROR: no .stringsdata in {BUILD}. Build the app for the simulator first.")

keys = set()
for path in files:
    if "Preview" in path:
        continue
    for table, entries in json.load(open(path)).get("tables", {}).items():
        if table != "Localizable":
            sys.exit(f"[ios-strings] ERROR: unexpected table {table} in {path}")
        keys.update(e["key"] for e in entries if e["key"])

def positional(key):
    counter = iter(range(1, 100))
    return re.sub(r"%(@|lld)", lambda m: f"%{next(counter)}${m.group(1)}", key)

strings = {}
for key in sorted(keys, key=str.lower):
    if len(re.findall(r"%(@|lld)", key)) >= 2:
        strings[key] = {"localizations": {"en": {"stringUnit": {"state": "translated", "value": positional(key)}}}}
    else:
        strings[key] = {}

with open(CATALOG, "w") as out:
    json.dump({"sourceLanguage": "en", "strings": strings, "version": "1.0"}, out, indent=2, ensure_ascii=False)
    out.write("\n")
print(f"[ios-strings] {len(strings)} strings written to {CATALOG}")
