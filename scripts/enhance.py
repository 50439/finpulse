#!/usr/bin/env python3
"""Доработка внешнего ролика (ChatGPT / телефон владельца) до публикации в TikTok."""
WHITE_YAVG = 200.0  # кадр светлее этого считаем «белым входом»


def white_seconds(lumas, fps):
    """По списку средних яркостей кадров — длительность белого входа в секундах."""
    n = 0
    for y in lumas:
        if y < WHITE_YAVG:
            break
        n += 1
    return n / fps if n < len(lumas) else 0.0

LEAD_IN, TAIL = 0.25, 0.30  # тишина до первой реплики и после последней


def plan_fit(seg_durs, video_dur, gap=0.25):
    """Длительность склейки реплик и коэффициент atempo, чтобы влезть в ролик.
    Возвращает (общая_длина, tempo); tempo=1.0, если и так помещается."""
    total = sum(seg_durs) + gap * max(len(seg_durs) - 1, 0)
    room = video_dur - LEAD_IN - TAIL
    if room <= 0:
        raise ValueError('ролик короче отступов')
    tempo = total / room if total > room else 1.0
    return total, tempo


# ---------------- I/O: ffmpeg / Kokoro / CLI ----------------
import argparse, json, os, re, subprocess, sys, tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SR = 24000
MAX_BYTES = 9_500_000   # лимит моста браузера при загрузке в TikTok Studio — 10 МБ
MAX_TEMPO = 1.25        # сильнее ускорять речь нельзя — звучит как мультик


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def probe_duration(path):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                      '-of', 'default=nw=1:nk=1', path]).stdout.strip())


def leading_white(path, fps=24, max_frames=48):
    """Сколько секунд в начале ролика занимают светлые кадры (fade из белого)."""
    r = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-vf',
                        f"select='lt(n\\,{max_frames})',signalstats,metadata=print:file=-",
                        '-f', 'null', '-'], capture_output=True, text=True)
    lumas = [float(m) for m in re.findall(r'lavfi\.signalstats\.YAVG=([\d.]+)', r.stdout)]
    return white_seconds(lumas, fps)


def tts_cfg():
    try:
        with open(os.path.join(ROOT, 'data', 'tts.json'), encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def synth(lines, voice, speed, lang, workdir):
    """Kokoro → wav реплик с обрезанной тишиной по краям. Возвращает [(path, dur)]."""
    import numpy as np, soundfile as sf
    from kokoro import KPipeline
    p = KPipeline(lang_code=lang)
    out = []
    for i, text in enumerate(lines):
        a = np.concatenate([x for _, _, x in p(text, voice=voice, speed=speed)])
        idx = np.where(np.abs(a) > 0.01)[0]
        if len(idx):
            a = a[max(idx[0] - int(0.05 * SR), 0):idx[-1] + int(0.08 * SR)]
        path = os.path.join(workdir, f's{i}.wav')
        sf.write(path, a, SR)
        out.append((path, len(a) / SR))
    return out


def concat_voice(segs, gap, tempo, workdir):
    import numpy as np, soundfile as sf
    parts = []
    for i, (path, _) in enumerate(segs):
        a, _ = sf.read(path)
        if i:
            parts.append(np.zeros(int(gap * SR)))
        parts.append(a)
    raw = os.path.join(workdir, 'vo_raw.wav')
    sf.write(raw, np.concatenate(parts), SR)
    vo = os.path.join(workdir, 'vo.wav')
    if tempo > 1.0:
        run(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-af', f'atempo={tempo:.4f}', vo])
    else:
        os.replace(raw, vo)
    return vo


def mix(src, vo, out, start, dur, bed=True, crf=22):
    """Голос + тёмная подложка (два расстроенных синуса + коричневый шум) → loudnorm → x264."""
    d = f'{dur:.3f}'
    ms = int(LEAD_IN * 1000)
    bed_in = ['-f', 'lavfi', '-t', d, '-i', 'sine=f=55:r=48000',
              '-f', 'lavfi', '-t', d, '-i', 'sine=f=57.5:r=48000',
              '-f', 'lavfi', '-t', d, '-i', 'anoisesrc=c=brown:r=48000:a=0.4']
    fc = f'[1:a]aresample=48000,adelay={ms}|{ms},apad[vo];'
    if bed:
        fc += (f'[2:a][3:a][4:a]amix=inputs=3:normalize=0,lowpass=f=140,tremolo=f=1.6:d=0.55,'
               f'volume=0.10,afade=t=in:d=0.6,afade=t=out:st={max(dur - 0.9, 0):.2f}:d=0.9[bed];'
               f'[vo][bed]amix=inputs=2:duration=first:normalize=0,')
    else:
        fc += '[vo]'
    fc += f'atrim=0:{d},loudnorm=I=-15:TP=-1.5:LRA=11[a]'
    run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{start:.3f}', '-i', src, '-i', vo,
         *(bed_in if bed else []), '-filter_complex', fc, '-map', '0:v', '-map', '[a]', '-t', d,
         '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf), '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('src')
    ap.add_argument('-o', '--out')
    ap.add_argument('--lines', default='', help='реплики через |')
    ap.add_argument('--lines-file')
    ap.add_argument('--voice')
    ap.add_argument('--speed', type=float)
    ap.add_argument('--no-bed', action='store_true')
    ap.add_argument('--keep-start', action='store_true', help='не срезать белый вход')
    a = ap.parse_args()

    raw = open(a.lines_file, encoding='utf-8').read().split('\n') if a.lines_file else a.lines.split('|')
    lines = [s.strip() for s in raw if s.strip()]
    if not lines:
        sys.exit('нет реплик: --lines "a|b|c" или --lines-file')
    cfg = tts_cfg()
    voice, speed, lang = a.voice or cfg.get('voice', 'af_heart'), a.speed or cfg.get('speed', 1.12), cfg.get('langCode', 'a')
    out = a.out or re.sub(r'\.mp4$', '', a.src) + '_voiced.mp4'

    start = 0.0 if a.keep_start else leading_white(a.src)
    dur = probe_duration(a.src) - start
    with tempfile.TemporaryDirectory() as wd:
        segs = synth(lines, voice, speed, lang, wd)
        total, tempo = plan_fit([d for _, d in segs], dur)
        if tempo > MAX_TEMPO:
            sys.exit(f'реплики слишком длинные: {total:.1f}с речи на {dur:.1f}с видео '
                     f'(нужно ×{tempo:.2f}, предел ×{MAX_TEMPO}) — сократите текст')
        vo = concat_voice(segs, 0.25, tempo, wd)
        crf = 22
        while True:
            mix(a.src, vo, out, start, dur, bed=not a.no_bed, crf=crf)
            size = os.path.getsize(out)
            if size <= MAX_BYTES or crf >= 30:
                break
            crf += 2
    print(json.dumps({'out': out, 'bytes': size, 'crf': crf, 'trimmed_start': round(start, 3),
                      'duration': round(dur, 2), 'speech': round(total, 2), 'tempo': round(tempo, 3),
                      'voice': voice, 'speed': speed}, ensure_ascii=False))


if __name__ == '__main__':
    main()
