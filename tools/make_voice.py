"""Make the read-aloud voice clips once (ElevenLabs text-to-speech), then trim the silence.

The app never calls a voice service: it joins these recorded clips on the device, offline.
Usage:  ELEVENLABS_API_KEY in the environment (on Windows the user-level variable is also read), ffmpeg on PATH.
        python tools/make_voice.py [ko|en ...] [--force]
"""
import json, os, subprocess, sys, tempfile, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VOICES = {'ko': 'PDoCXqBQFGsvfO0hNkEs',   # Chris
          'en': 'Se2Vw1WbHmGbBbyWTuu4'}   # Allison
# context so a single number or word is spoken the way it sounds inside a sentence
CONTEXT = {'ko': {'numbers': ('받으신 돈은', '원입니다.'), 'currency': ('받으신 돈은 이만', '입니다.'), 'labels': ('', '삼만 원.')},
           'en': {'numbers': ('You received', 'rupees.'), 'currency': ('You received forty', '.'), 'labels': ('', 'three hundred rupees.')}}


def api_key():
    k = os.environ.get('ELEVENLABS_API_KEY')
    if not k and os.name == 'nt':
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as h:
            k = winreg.QueryValueEx(h, 'ELEVENLABS_API_KEY')[0]
    if not k:
        sys.exit('ELEVENLABS_API_KEY is not set')
    return k


def tts(key, voice, text, prev='', nxt=''):
    body = {'text': text, 'model_id': 'eleven_multilingual_v2',
            'voice_settings': {'stability': 0.6, 'similarity_boost': 0.8, 'style': 0.0, 'use_speaker_boost': True}}
    if prev: body['previous_text'] = prev
    if nxt: body['next_text'] = nxt
    req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128',
                                 data=json.dumps(body).encode(), headers={'xi-api-key': key, 'Content-Type': 'application/json',
                                 'Accept': 'audio/mpeg', 'User-Agent': 'slipcheck-voice-script'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def trim(src, dst):
    af = ('silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.02,areverse,'
          'silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.04,areverse')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-af', af, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', dst], check=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    table = json.load(open(os.path.join(ROOT, 'voice', 'clips.json'), encoding='utf-8'))
    key = api_key()
    for lang in args or ['en']:   # Korean: tools/make_voice_ko.py (cut from whole sentences)
        t, out = table[lang], os.path.join(ROOT, 'voice', lang)
        os.makedirs(out, exist_ok=True)
        jobs = [(k, v, 'phrases') for k, v in t['phrases'].items()] + [(k, v, 'numbers') for k, v in t['numbers'].items()] \
             + [(k, v, 'currency') for k, v in t['currency'].items()] + [(k, v[1], 'labels') for k, v in t['labels'].items()]
        made = 0
        for cid, text, kind in jobs:
            dst = os.path.join(out, cid + '.mp3')
            if os.path.exists(dst) and not force:
                continue
            prev, nxt = CONTEXT[lang].get(kind, ('', ''))
            try:
                audio = tts(key, VOICES[lang], text, prev, nxt)
            except urllib.error.HTTPError as e:
                print(lang, cid, 'HTTP', e.code, e.read()[:160]); continue
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
                f.write(audio); raw = f.name
            trim(raw, dst); os.unlink(raw); made += 1
        print(lang, 'clips made:', made, 'total:', len(jobs))


if __name__ == '__main__':
    main()
