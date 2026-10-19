#!/usr/bin/env python3
"""Writes the screenshot seed (store/seed/seed.json, from generate.mjs) into a simulator's BoxHockey
install BEFORE it launches, so it opens on Home with sound off, the guide seen, Sam and Riley's
profiles, three weeks of stats and achievements, and the match settings a shot needs. See
store/README.md.

  write-store.py <simulator udid> [--mode vsCpu|twoPlayer] [--board classic|gauntlet|gravity] [--rink]
                 [--preview off|short|medium|long] [--scheme flick|stick|pull|push]
                 [--difficulty easy|medium|hard] [--tipoff faceoff|coinFlip|tripleTap]

Defaults: Vs CPU on Medium, Classic, no Rink, the default Face-Off and Flick, preview off. Sam is in
seat 1; Riley takes seat 2 in Two Player. The app must not be running.

The store is redux-persist on @react-native-async-storage: on iOS, Library/Application Support/<bundle
id>/RCTAsyncLocalStorage_V1, with values over 1024 characters in a file named by the MD5 of the key.
The key is src/redux/store.ts's persistConfig keyPrefix plus its key ('boxhockey:root');
keep it in step with that file, or the app ignores everything this writes. Slices left out keep their
initial state, and settings missing a field get it from DEFAULT_SETTINGS.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess

BUNDLE = 'com.infinitetoken.BoxHockey'
KEY = 'boxhockey:root'
HERE = os.path.dirname(os.path.abspath(__file__))

parser = argparse.ArgumentParser()
parser.add_argument('udid')
parser.add_argument('--mode', default='vsCpu', choices=['vsCpu', 'twoPlayer'])
parser.add_argument('--board', default='classic', choices=['classic', 'gauntlet', 'gravity'])
parser.add_argument('--rink', action='store_true')
parser.add_argument('--preview', default='off', choices=['off', 'short', 'medium', 'long'])
parser.add_argument('--scheme', default='flick', choices=['flick', 'stick', 'pull', 'push'])
parser.add_argument('--difficulty', default='medium', choices=['easy', 'medium', 'hard'])
parser.add_argument('--tipoff', default='faceoff', choices=['faceoff', 'coinFlip', 'tripleTap'])
args = parser.parse_args()

seed = json.load(open(os.path.join(HERE, 'seed.json')))
sam, riley = (p['id'] for p in seed['profiles'])
extensions = {pid: {'controlScheme': args.scheme} for pid in (sam, riley)}

root = {
    'achievements': {'stats': seed['stats'], 'unlocked': seed['unlocked']},
    'sound': {'enabled': False},
    'guide': {'versionSeen': 1},
    'profiles': seed['profiles'],
    'profileExtensions': extensions,
    'profileSelection': {'1': sam, '2': riley if args.mode == 'twoPlayer' else None},
    'settings': {
        'gameMode': args.mode,
        'boardVariant': args.board,
        'rink': args.rink,
        'shotPreviewLength': args.preview,
        'aiDifficulty': args.difficulty,
        'tipoffMode': args.tipoff,
        'controlScheme': {'1': args.scheme, '2': args.scheme},
    },
}
value = {k: json.dumps(v) for k, v in root.items()}
value['_persist'] = json.dumps({'version': -1, 'rehydrated': True})
text = json.dumps(value)

container = subprocess.check_output(['xcrun', 'simctl', 'get_app_container', args.udid, BUNDLE, 'data'], text=True).strip()
store_dir = os.path.join(container, 'Library/Application Support', BUNDLE, 'RCTAsyncLocalStorage_V1')
shutil.rmtree(store_dir, ignore_errors=True)
os.makedirs(store_dir)
manifest = {}
if len(text) > 1024:
    open(os.path.join(store_dir, hashlib.md5(KEY.encode()).hexdigest()), 'w').write(text)
    manifest[KEY] = None
else:
    manifest[KEY] = text
json.dump(manifest, open(os.path.join(store_dir, 'manifest.json'), 'w'))
print(f'Seeded {args.mode} on {args.board}{" with Rink" if args.rink else ""} ({len(text)} characters)')
