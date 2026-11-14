"""Korean read-aloud clips, cut out of whole spoken sentences (unit selection).

Recording each number word on its own gives every clip the falling tone and the breath of a sentence end,
so joined clips sound choppy. Here whole carrier sentences ("받으신 돈은 이천사백오십육만 칠천 원입니다.")
are spoken once with character timestamps (ElevenLabs /with-timestamps), and each unit is cut from the
middle of a sentence. Every number unit exists twice: _p (more of the number follows) and _f (last unit).
The app joins the cuts offline (voice.js); no voice service is called at run time.
Usage: python tools/make_voice_ko.py [--force]     (ELEVENLABS_API_KEY in the environment, ffmpeg on PATH)
"""
import base64, json, os, subprocess, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'voice', os.environ.get('KO_OUT', 'ko')); CACHE = os.path.join(HERE, '.carriers_ko')   # raw carriers, not shipped
VOICE = 'PDoCXqBQFGsvfO0hNkEs'   # Chris
D = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
def th(d): return ('' if d == 1 else D[d]) + '천'
def hu(d): return ('' if d == 1 else D[d]) + '백'
def k99(n):
    t, u = divmod(n, 10)
    return ('' if t < 2 else D[t]) + ('십' if t else '') + (D[u] if u else '')
CUR = {'KRW': '원', 'INR': '루피', 'MXN': '페소', 'USD': '달러'}
LABELS = {'l_commission': '위탁수수료', 'l_fee': '수수료', 'l_handling': '하역비', 'l_transport': '운송비', 'l_freight': '운임',
          'l_loading': '상차비', 'l_unloading': '하차비', 'l_sorting': '선별비', 'l_packing': '포장비', 'l_prep': '준비비',
          'l_market': '시장 사용료', 'l_weighing': '계량비', 'l_cess': '시장세', 'l_other': '기타 공제'}


def carriers():
    """Each carrier: list of (text, unit_id or None). Units are cut; None parts are context only."""
    C = []
    for k in range(1, 100):                         # every 1-99 before 만 and at the end, with 천/백 around them
        a, b, c, d = (k % 9) + 1, ((k + 3) % 9) + 1, ((k + 5) % 9) + 1, ((k + 7) % 9) + 1
        C.append([('받으신 돈은', 'p_got'), (' ', None), (th(a), f'x1000_{a}_p'), (hu(b), f'x100_{b}_p'), (k99(k), f'k{k}_p'),
                  ('만', 'man_p'), (' ', None), (th(c), f'x1000_{c}_p'), (hu(d), f'x100_{d}_p'), (k99(k), f'k{k}_f'),
                  (' ', None), ('원입니다.', 'c_KRW_end')])
    for d in range(1, 10):                          # 천 / 백 as the last unit
        C.append([('받으신 돈은 오만 ', None), (th(d), f'x1000_{d}_f'), (' 원입니다.', None)])
        C.append([('받으신 돈은 오만 ', None), (hu(d), f'x100_{d}_f'), (' 원입니다.', None)])
    C.append([('받으신 돈은 이십', None), ('만', 'man_f'), (' 원입니다.', None)])
    C.append([('받으신 돈은 일', None), ('억', 'eok_p'), (' 이천만 원입니다.', None)])
    C.append([('받으신 돈은 삼', None), ('억', 'eok_f'), (' 원입니다.', None)])
    C.append([('판매 금액은', 'p_sold'), (' 이백삼십팔만 원입니다.', None)])
    C.append([('공제된 돈은', 'p_ded'), (' 삼십삼만 칠천 원입니다.', None)])
    for code, w in CUR.items():
        if code != 'KRW': C.append([('받으신 돈은 사만 육천 ', None), (w + '입니다.', f'c_{code}_end')])
        C.append([('운송비, 삼만 ', None), (w + '.', f'c_{code}_list')])
    for d in range(10):                             # percent with one decimal
        C.append([('판매 금액의', 'p_pct_pre'), (' 십삼 ', None), ('점', 'point'), (' ', None), ((D[d] or '영'), f'dd{d}'),
                  (' ', None), ('퍼센트입니다.', 'p_pct')])
    for lid, w in LABELS.items():
        C.append([(w, lid), (', 삼만 원.', None)])
    return C


def speak(key, text):
    body = {'text': text, 'model_id': 'eleven_multilingual_v2', 'apply_text_normalization': 'off',
            'voice_settings': {'stability': 0.6, 'similarity_boost': 0.8, 'style': 0.0, 'use_speaker_boost': True}}
    req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{VOICE}/with-timestamps?output_format=mp3_44100_128',
        data=json.dumps(body).encode(), headers={'xi-api-key': key, 'Content-Type': 'application/json', 'User-Agent': 'slipcheck-voice-script'})
    return json.load(urllib.request.urlopen(req, timeout=90))


def api_key():
    k = os.environ.get('ELEVENLABS_API_KEY')
    if not k and os.name == 'nt':
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as h: k = winreg.QueryValueEx(h, 'ELEVENLABS_API_KEY')[0]
    return k


def main():
    force = '--force' in sys.argv
    os.makedirs(OUT, exist_ok=True); os.makedirs(CACHE, exist_ok=True)
    key = api_key(); done = set()
    for i, parts in enumerate(carriers()):
        text = ''.join(p for p, _ in parts)
        units = [(u, p) for p, u in parts if u]
        if all(u in done or (os.path.exists(os.path.join(OUT, u + '.mp3')) and not force) for u, _ in units):
            continue
        cj, ca = os.path.join(CACHE, f'{i:03d}.json'), os.path.join(CACHE, f'{i:03d}.mp3')
        if not os.path.exists(cj) or force:
            d = speak(key, text)
            open(ca, 'wb').write(base64.b64decode(d['audio_base64']))
            json.dump({'text': text, 'alignment': d['alignment']}, open(cj, 'w', encoding='utf-8'), ensure_ascii=False)
        al = json.load(open(cj, encoding='utf-8'))['alignment']
        st, en = al['character_start_times_seconds'], al['character_end_times_seconds']
        pos = 0
        for p, u in parts:
            a, b = pos, pos + len(p) - 1; pos += len(p)
            if not u or u in done: continue
            dst = os.path.join(OUT, u + '.mp3')
            if os.path.exists(dst) and not force and u not in done:
                done.add(u); continue
            t0, t1 = st[a], en[b]
            dur = max(0.05, t1 - t0)
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{t0:.3f}', '-t', f'{dur:.3f}', '-i', ca,
                            '-af', f'afade=t=in:d=0.008,afade=t=out:st={max(0, dur - 0.012):.3f}:d=0.012', '-ac', '1',
                            '-c:a', 'libmp3lame', '-b:a', '64k', dst], check=True)
            done.add(u)
    print('units:', len(done))


if __name__ == '__main__':
    main()
