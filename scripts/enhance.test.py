"""Тесты чистых функций доработки внешних роликов: python3 scripts/enhance.test.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enhance as e

# white_seconds: 6 белых кадров при 24 fps = 0.25 с
assert e.white_seconds([245, 240, 236, 230, 220, 210, 40, 35, 38], 24) == 6 / 24

# весь ролик светлый — не срезаем ничего (иначе съедим всё видео); пустой список — 0
assert e.white_seconds([245, 245, 245], 24) == 0.0
assert e.white_seconds([], 24) == 0.0
assert e.white_seconds([40, 35], 24) == 0.0

# plan_fit: 4 реплики по 2.5 с + 3 паузы по 0.25 = 10.75 с; ролик 12.5 − 0.55 отступов = 11.95 → помещается
total, tempo = e.plan_fit([2.5, 2.5, 2.5, 2.5], 12.5)
assert abs(total - 10.75) < 1e-9 and tempo == 1.0

# 14.55 с речи в 12.5 с — нужно ускорение ×~1.22; одна реплика — без пауз; ролик короче отступов — ошибка
total, tempo = e.plan_fit([3.77, 4.03, 3.35, 3.4], 12.5)
assert total > 12 and 1.2 < tempo < 1.3
assert e.plan_fit([3.0], 10.0)[0] == 3.0
try:
    e.plan_fit([1.0], 0.4); assert False, 'ожидали ValueError'
except ValueError:
    pass

print('enhance: ok')
