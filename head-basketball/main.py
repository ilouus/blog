#!/usr/bin/env python3
"""Head Basketball — böyük başlı oyunçularla 2D basketbol (Python + Pygame).

İşə salmaq:  python main.py
Test rejimi: python main.py --selftest       (ekransız, CPU-ya qarşı CPU)
Ekran şəkli: python main.py --screenshot shot.png
"""

import math
import os
import random
import sys
from array import array

import pygame

# ---------------------------------------------------------------------------
# Parametrlər
# ---------------------------------------------------------------------------
W, H = 1280, 720
FPS = 60
FLOOR_Y = 640

BALL_R = 20
BALL_GRAVITY = 0.42
BALL_MAX_SPEED = 28
SUBSTEPS = 3

PLAYER_GRAVITY = 0.65
JUMP_SPEED = 14.5
MOVE_SPEED = 6.2
HEAD_R = 40
HEAD_OFFSET = 100  # ayaqdan başın mərkəzinə qədər məsafə

RIM_Y = 330
RIM_R = 5
RIM_LEN = 90  # lövhədən ön halqaya qədər
BOARD_W = 40
BOARD_TOP, BOARD_BOTTOM = 190, 360
NET_DEPTH = 62
THREE_PT_DIST = 460

SHOOT_RANGE = 88
SHOOT_COOLDOWN = 30

DIFFICULTIES = ["Asan", "Orta", "Çətin"]
DURATIONS = [60, 90, 120]

COL_BG_TOP = (18, 24, 48)
COL_BG_BOTTOM = (46, 38, 70)
COL_WOOD = (206, 146, 84)
COL_WOOD_DARK = (176, 118, 64)
COL_LINE = (250, 245, 235)
COL_RIM = (240, 90, 30)
COL_TEXT = (255, 255, 255)
COL_GOLD = (255, 210, 60)

TEAMS = [
    dict(jersey=(220, 50, 60), trim=(255, 230, 230), hair=(60, 36, 20), skin=(240, 196, 150)),
    dict(jersey=(40, 110, 220), trim=(220, 235, 255), hair=(245, 200, 70), skin=(200, 150, 110)),
]


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


# ---------------------------------------------------------------------------
# Səs (sadə sintez, fayl lazım deyil)
# ---------------------------------------------------------------------------
class Sounds:
    def __init__(self, enabled=True):
        self.snd = {}
        if not enabled:
            return
        try:
            info = pygame.mixer.get_init()
            if not info:
                return
            self.rate, _, self.channels = info
            self.snd["bounce"] = self._make([(110, 0.12)], vol=0.45, decay=28, noise=0.35)
            self.snd["kick"] = self._make([(180, 0.10)], vol=0.4, decay=30, noise=0.5)
            self.snd["rim"] = self._make([(880, 0.35), (1320, 0.35)], vol=0.25, decay=10)
            self.snd["board"] = self._make([(220, 0.15)], vol=0.35, decay=22, noise=0.6)
            self.snd["score"] = self._make([(523, 0.12), (659, 0.12), (784, 0.12), (1046, 0.3)],
                                           vol=0.3, decay=5, seq=True)
            self.snd["whistle"] = self._make([(2100, 0.45)], vol=0.2, decay=1.5, vibrato=40)
            self.snd["buzzer"] = self._make([(220, 0.9), (233, 0.9)], vol=0.25, decay=1.2, square=True)
            self.snd["tick"] = self._make([(1000, 0.06)], vol=0.2, decay=30)
        except Exception:
            self.snd = {}

    def _make(self, notes, vol=0.4, decay=8.0, noise=0.0, seq=False, vibrato=0, square=False):
        rate = self.rate
        buf = array("h")
        groups = [[n] for n in notes] if seq else [notes]
        for group in groups:
            dur = max(d for _, d in group)
            for i in range(int(rate * dur)):
                t = i / rate
                s = 0.0
                for f, _ in group:
                    ph = 2 * math.pi * f * t + (vibrato * math.sin(2 * math.pi * 6 * t) / f if vibrato else 0)
                    v = math.sin(ph)
                    if square:
                        v = 1.0 if v >= 0 else -1.0
                    s += v
                s /= len(group)
                if noise:
                    s = s * (1 - noise) + random.uniform(-1, 1) * noise
                sample = int(32767 * vol * math.exp(-decay * t) * s)
                for _ in range(self.channels):
                    buf.append(sample)
        return pygame.mixer.Sound(buffer=buf.tobytes())

    def play(self, name, volume=1.0):
        s = self.snd.get(name)
        if s:
            s.set_volume(clamp(volume, 0.0, 1.0))
            s.play()


# ---------------------------------------------------------------------------
# Oyun obyektləri
# ---------------------------------------------------------------------------
class Hoop:
    def __init__(self, side):
        self.side = side  # -1 sol, +1 sağ
        if side < 0:
            self.board = pygame.Rect(0, BOARD_TOP, BOARD_W, BOARD_BOTTOM - BOARD_TOP)
            self.board_face = BOARD_W
            self.front_x = BOARD_W + RIM_LEN
        else:
            self.board = pygame.Rect(W - BOARD_W, BOARD_TOP, BOARD_W, BOARD_BOTTOM - BOARD_TOP)
            self.board_face = W - BOARD_W
            self.front_x = W - BOARD_W - RIM_LEN
        self.lo = min(self.board_face, self.front_x)
        self.hi = max(self.board_face, self.front_x)
        self.center_x = (self.board_face + self.front_x) / 2
        self.net_timer = 0

    def inside(self, x):
        return self.lo < x < self.hi


class Ball:
    def __init__(self):
        self.reset(W / 2, 250)

    def reset(self, x, y, vx=0.0, vy=0.0):
        self.x, self.y = x, y
        self.vx, self.vy = vx, vy
        self.angle = 0.0
        self.shooter = None
        self.three = False
        self.ignore = None
        self.ignore_timer = 0
        self.scored_in = None


class Player:
    def __init__(self, side, team, name):
        self.side = side  # müdafiə etdiyi səbətin tərəfi
        self.attack_dir = -side
        self.team = team
        self.name = name
        self.speed_mult = 1.0
        self.accuracy = 1.0
        self.reset()

    def reset(self):
        self.x = W / 2 + self.side * 330
        self.y = FLOOR_Y
        self.vx = self.vy = 0.0
        self.on_ground = True
        self.shoot_cd = 0
        self.arm_anim = 0
        self.blink = random.randint(60, 240)

    @property
    def facing(self):
        return self.attack_dir

    def circles(self):
        f = self.facing
        return (
            (self.x, self.y - HEAD_OFFSET, HEAD_R),
            (self.x, self.y - 50, 24),
            (self.x + f * 10, self.y - 16, 16),
        )

    def update(self, inp, frozen=False):
        if frozen:
            inp = {}
        target = (inp.get("right", 0) - inp.get("left", 0)) * MOVE_SPEED * self.speed_mult
        self.vx += (target - self.vx) * 0.35
        if inp.get("jump") and self.on_ground:
            self.vy = -JUMP_SPEED
            self.on_ground = False
        self.vy += PLAYER_GRAVITY
        self.x += self.vx
        self.y += self.vy
        if self.y >= FLOOR_Y:
            self.y = FLOOR_Y
            self.vy = 0.0
            self.on_ground = True
        self.x = clamp(self.x, HEAD_R, W - HEAD_R)
        if self.shoot_cd > 0:
            self.shoot_cd -= 1
        if self.arm_anim > 0:
            self.arm_anim -= 1
        self.blink -= 1
        if self.blink < -6:
            self.blink = random.randint(90, 260)


def separate_players(a, b):
    """Oyunçuların bir-birinin içinə girməsinin qarşısını alır."""
    ax, ay, ar = a.circles()[0]
    bx, by, br = b.circles()[0]
    for (cx1, cy1, r1), (cx2, cy2, r2) in (((ax, ay, ar), (bx, by, br)),
                                           (a.circles()[1], b.circles()[1])):
        dx, dy = cx2 - cx1, cy2 - cy1
        d = math.hypot(dx, dy)
        md = r1 + r2
        if 0 < d < md:
            push = (md - d) / 2
            nx, ny = dx / d, dy / d
            a.x -= nx * push
            b.x += nx * push
            # başın üstünə düşəndə yuxarıdakı oyunçu dayansın
            if ny > 0.6 and a.vy > 0:
                a.y -= push * 2 * ny
                a.vy = 0
                a.on_ground = True
            elif ny < -0.6 and b.vy > 0:
                b.y += push * 2 * ny
                b.vy = 0
                b.on_ground = True
    a.x = clamp(a.x, HEAD_R, W - HEAD_R)
    b.x = clamp(b.x, HEAD_R, W - HEAD_R)


# ---------------------------------------------------------------------------
# Fizika
# ---------------------------------------------------------------------------
def collide_circle(ball, cx, cy, r, ovx=0.0, ovy=0.0, e=0.6):
    dx, dy = ball.x - cx, ball.y - cy
    md = BALL_R + r
    d2 = dx * dx + dy * dy
    if d2 >= md * md:
        return 0.0
    d = math.sqrt(d2)
    if d < 1e-6:
        nx, ny = 0.0, -1.0
    else:
        nx, ny = dx / d, dy / d
    ball.x, ball.y = cx + nx * md, cy + ny * md
    rvx, rvy = ball.vx - ovx, ball.vy - ovy
    vn = rvx * nx + rvy * ny
    if vn < 0:
        ball.vx -= (1 + e) * vn * nx
        ball.vy -= (1 + e) * vn * ny
        return -vn
    return 0.0


def collide_rect(ball, rect, e=0.7):
    px = clamp(ball.x, rect.left, rect.right)
    py = clamp(ball.y, rect.top, rect.bottom)
    dx, dy = ball.x - px, ball.y - py
    d2 = dx * dx + dy * dy
    if d2 >= BALL_R * BALL_R:
        return 0.0
    d = math.sqrt(d2)
    if d < 1e-6:  # mərkəz düzbucaqlının içindədir: ən yaxın açıq tərəfə it (divara yox)
        faces = [(ball.y - rect.top, 0.0, -1.0), (rect.bottom - ball.y, 0.0, 1.0)]
        if rect.left > 0:
            faces.append((ball.x - rect.left, -1.0, 0.0))
        if rect.right < W:
            faces.append((rect.right - ball.x, 1.0, 0.0))
        _, nx, ny = min(faces)
        if nx:
            ball.x = (rect.right if nx > 0 else rect.left) + nx * BALL_R
        else:
            ball.y = (rect.bottom if ny > 0 else rect.top) + ny * BALL_R
    else:
        nx, ny = dx / d, dy / d
        ball.x, ball.y = px + nx * BALL_R, py + ny * BALL_R
    vn = ball.vx * nx + ball.vy * ny
    if vn < 0:
        ball.vx -= (1 + e) * vn * nx
        ball.vy -= (1 + e) * vn * ny
        return -vn
    return 0.0


def plan_shot(bx, by, tx, ty):
    """(bx,by) nöqtəsindən (tx,ty)-yə düşən qövs üçün sürət qaytarır."""
    dist = abs(tx - bx)
    g = BALL_GRAVITY
    t = 50 + dist / 20
    max_rise = max(80.0, by - 60)
    while t > 30:
        vy = (ty - by - g * t * t / 2) / t
        if vy * vy / (2 * g) <= max_rise:
            break
        t -= 1
    vx = (tx - bx) / t
    vy = (ty - by - g * t * t / 2) / t
    return vx, vy


def try_shoot(player, ball, hoop):
    if player.shoot_cd > 0:
        return False
    head, body, _ = player.circles()
    near = min(math.hypot(ball.x - head[0], ball.y - head[1]),
               math.hypot(ball.x - body[0], ball.y - body[1]))
    player.shoot_cd = 12
    player.arm_anim = 14
    if near > SHOOT_RANGE:
        return False
    player.shoot_cd = SHOOT_COOLDOWN
    dist = abs(hoop.center_x - ball.x)
    sigma = (16 + dist * 0.12) * player.accuracy
    tx = hoop.center_x + random.gauss(0, sigma)
    ty = RIM_Y - 4
    ball.vx, ball.vy = plan_shot(ball.x, ball.y, tx, ty)
    ball.shooter = player
    ball.three = abs(ball.x - hoop.board_face) >= THREE_PT_DIST
    ball.ignore = player
    ball.ignore_timer = 14
    return True


class World:
    """Topun, oyunçuların və səbətlərin fizikası."""

    def __init__(self, sounds):
        self.sounds = sounds
        self.hoops = {-1: Hoop(-1), 1: Hoop(1)}
        self.ball = Ball()
        self.players = []

    def attack_hoop(self, player):
        return self.hoops[player.attack_dir]

    def step_ball(self, allow_score=True):
        """Bir kadr üçün topu hərəkət etdirir. Qol olubsa, həmin səbəti qaytarır."""
        b = self.ball
        dt = 1.0 / SUBSTEPS
        scored = None
        if b.ignore_timer > 0:
            b.ignore_timer -= 1
            if b.ignore_timer == 0:
                b.ignore = None
        for _ in range(SUBSTEPS):
            prev_y = b.y
            b.vy += BALL_GRAVITY * dt
            sp = math.hypot(b.vx, b.vy)
            if sp > BALL_MAX_SPEED:
                b.vx *= BALL_MAX_SPEED / sp
                b.vy *= BALL_MAX_SPEED / sp
            b.x += b.vx * dt
            b.y += b.vy * dt

            for hoop in self.hoops.values():
                imp = collide_rect(b, hoop.board, 0.65)
                if imp > 3:
                    self.sounds.play("board", imp / 12)
                imp = collide_circle(b, hoop.front_x, RIM_Y, RIM_R, e=0.55)
                if imp > 1.5:
                    self.sounds.play("rim", imp / 10)
                if hoop.inside(b.x):
                    if prev_y < RIM_Y <= b.y and b.vy > 0:
                        if allow_score and scored is None and b.scored_in is None:
                            scored = hoop
                            b.scored_in = hoop
                        hoop.net_timer = 40
                    elif prev_y > RIM_Y >= b.y and b.vy < 0:
                        # tor topun aşağıdan keçməsinə imkan vermir
                        b.y = RIM_Y + 1
                        b.vy = abs(b.vy) * 0.3
                    # tor topu yavaşladır
                    if RIM_Y < b.y < RIM_Y + NET_DEPTH:
                        b.vx *= 0.97
                        b.x = clamp(b.x, hoop.lo + BALL_R * 0.6, hoop.hi - BALL_R * 0.6)

            for p in self.players:
                if p is b.ignore:
                    continue
                hit = 0.0
                for i, (cx, cy, r) in enumerate(p.circles()):
                    e = 0.75 if i == 0 else 0.45
                    hit = max(hit, collide_circle(b, cx, cy, r, p.vx, p.vy, e))
                if hit > 0:
                    b.shooter = None
                    b.three = False
                    if hit > 4:
                        self.sounds.play("kick", hit / 14)

            # döşəmə, tavan, divarlar
            if b.y + BALL_R > FLOOR_Y:
                b.y = FLOOR_Y - BALL_R
                if b.vy > 0:
                    if b.vy > 2.5:
                        self.sounds.play("bounce", b.vy / 14)
                    b.vy = -b.vy * 0.72
                    if abs(b.vy) < 1.2:
                        b.vy = 0.0
                b.vx *= 0.995
            if b.y - BALL_R < 0:
                b.y = BALL_R
                b.vy = abs(b.vy) * 0.6
            if b.x - BALL_R < 0:
                b.x = BALL_R
                b.vx = abs(b.vx) * 0.7
            if b.x + BALL_R > W:
                b.x = W - BALL_R
                b.vx = -abs(b.vx) * 0.7

        b.angle -= b.vx * 2.9  # dərəcə
        for hoop in self.hoops.values():
            if hoop.net_timer > 0:
                hoop.net_timer -= 1
        if b.scored_in is not None and b.y > RIM_Y + NET_DEPTH + BALL_R:
            b.scored_in = None
        return scored


# ---------------------------------------------------------------------------
# Süni intellekt
# ---------------------------------------------------------------------------
class AI:
    LEVELS = [
        dict(speed=0.72, react=16, acc=1.7, shoot=0.03, jump=0.35),
        dict(speed=0.88, react=9, acc=1.2, shoot=0.08, jump=0.6),
        dict(speed=1.0, react=4, acc=0.9, shoot=0.18, jump=0.9),
    ]

    def __init__(self, player, level):
        self.p = player
        self.cfg = self.LEVELS[level]
        player.speed_mult = self.cfg["speed"]
        player.accuracy = self.cfg["acc"]
        self.timer = 0
        self.target = player.x
        self.want_jump = False

    def think(self, world, opponent):
        p, b, cfg = self.p, world.ball, self.cfg
        d = p.attack_dir
        own = world.hoops[p.side]
        self.timer -= 1
        if self.timer <= 0:
            self.timer = cfg["react"] + random.randint(0, cfg["react"] // 2 + 1)
            k = 14
            px = clamp(b.x + b.vx * k, BALL_R, W - BALL_R)
            # topun arxasında dayan (hücum istiqamətinin əksində)
            self.target = px - d * 36
            # rəqib topla bizim səbətə yaxınlaşırsa, müdafiəyə keç
            opp_near_ball = math.hypot(opponent.x - b.x, opponent.y - HEAD_OFFSET - b.y) < 130
            if opp_near_ball and (b.x - p.x) * d < 0 and abs(own.center_x - b.x) < 700:
                self.target = b.x - d * 70
            self.want_jump = random.random() < cfg["jump"]

        inp = {}
        dx = self.target - p.x
        if dx < -8:
            inp["left"] = 1
        elif dx > 8:
            inp["right"] = 1

        hx, hy, _ = p.circles()[0]
        bdx = b.x - p.x
        if self.want_jump:
            if abs(bdx) < 80 and hy - 240 < b.y < hy - 30 and b.vy > -3:
                inp["jump"] = 1
            # uzaqdan atılan topu blokla
            if b.vx * d < -3 and b.vy < 2 and 20 < -bdx * d < 170 and b.y < hy:
                inp["jump"] = 1

        head, body, _ = p.circles()
        near = min(math.hypot(b.x - head[0], b.y - head[1]),
                   math.hypot(b.x - body[0], b.y - body[1]))
        if near < SHOOT_RANGE - 6 and p.shoot_cd == 0:
            dist = abs(world.attack_hoop(p).center_x - b.x)
            rate = cfg["shoot"] * (2.5 if dist < 500 else 1.0)
            if random.random() < rate:
                inp["shoot"] = 1
        return inp


# ---------------------------------------------------------------------------
# Çəkmə
# ---------------------------------------------------------------------------
class Renderer:
    def __init__(self):
        self.font_big = pygame.font.Font(None, 96)
        self.font_mid = pygame.font.Font(None, 56)
        self.font = pygame.font.Font(None, 36)
        self.font_small = pygame.font.Font(None, 26)
        self.bg = self._make_background()
        self.ball_img = self._make_ball()

    def _make_background(self):
        surf = pygame.Surface((W, H))
        for y in range(H):
            t = y / H
            c = [int(COL_BG_TOP[i] + (COL_BG_BOTTOM[i] - COL_BG_TOP[i]) * t) for i in range(3)]
            pygame.draw.line(surf, c, (0, y), (W, y))
        rng = random.Random(7)
        # tribuna
        pygame.draw.rect(surf, (30, 28, 48), (0, 150, W, FLOOR_Y - 150 - 90))
        for row in range(9):
            y = 170 + row * 36
            for x in range(10 + (row % 2) * 16, W, 32):
                c = rng.choice([(200, 60, 70), (60, 100, 200), (230, 230, 230), (240, 200, 70),
                                (90, 180, 110), (160, 90, 190), (60, 60, 70)])
                c = [int(v * (0.45 + row * 0.04)) for v in c]
                pygame.draw.circle(surf, c, (x + rng.randint(-3, 3), y + rng.randint(-3, 3)), 11)
                pygame.draw.rect(surf, [int(v * 0.8) for v in c], (x - 13, y + 8, 26, 16),
                                 border_top_left_radius=8, border_top_right_radius=8)
        # reklam lövhəsi
        pygame.draw.rect(surf, (20, 20, 30), (0, FLOOR_Y - 90, W, 90))
        pygame.draw.rect(surf, (255, 150, 40), (0, FLOOR_Y - 90, W, 4))
        fnt = pygame.font.Font(None, 54)
        for i, txt in enumerate(["HEAD BASKETBALL", "AZƏRBAYCAN LİQASI", "HEAD BASKETBALL"]):
            img = fnt.render(txt, True, (255, 150, 40) if i != 1 else (90, 200, 255))
            surf.blit(img, img.get_rect(center=(W * (i + 0.5) / 3, FLOOR_Y - 45)))
        # işıqlar
        for x in range(80, W, 160):
            glow = pygame.Surface((120, 120), pygame.SRCALPHA)
            for r in range(60, 0, -6):
                pygame.draw.circle(glow, (255, 250, 220, int(40 * (1 - r / 60)) + 4), (60, 60), r)
            surf.blit(glow, (x - 60, 20))
            pygame.draw.circle(surf, (255, 255, 235), (x, 80), 9)
        # döşəmə
        pygame.draw.rect(surf, COL_WOOD, (0, FLOOR_Y, W, H - FLOOR_Y))
        for x in range(0, W, 72):
            pygame.draw.line(surf, COL_WOOD_DARK, (x, FLOOR_Y), (x - 30, H), 2)
        for y in range(FLOOR_Y + 22, H, 22):
            pygame.draw.line(surf, COL_WOOD_DARK, (0, y), (W, y), 1)
        pygame.draw.line(surf, (240, 190, 130), (0, FLOOR_Y), (W, FLOOR_Y), 3)
        # meydança xətləri
        pygame.draw.line(surf, COL_LINE, (W // 2, FLOOR_Y), (W // 2 - 20, H), 4)
        pygame.draw.ellipse(surf, COL_LINE, (W // 2 - 110, FLOOR_Y + 14, 220, 50), 3)
        small = pygame.font.Font(None, 30)
        for x in (BOARD_W + THREE_PT_DIST, W - BOARD_W - THREE_PT_DIST):
            pygame.draw.line(surf, COL_LINE, (x, FLOOR_Y), (x - 20, H), 4)
            img = small.render("3", True, COL_LINE)
            surf.blit(img, (x + 8, FLOOR_Y + 8))
        return surf

    def _make_ball(self):
        s = 3
        size = BALL_R * 2 * s
        img = pygame.Surface((size + 4, size + 4), pygame.SRCALPHA)
        c = size // 2 + 2
        r = BALL_R * s
        pygame.draw.circle(img, (235, 115, 30), (c, c), r)
        pygame.draw.circle(img, (255, 150, 70), (c - r // 3, c - r // 3), r // 2)
        pygame.draw.circle(img, (235, 115, 30), (c - r // 4, c - r // 4), r // 2 - 4)
        seam = (60, 25, 10)
        pygame.draw.line(img, seam, (c - r, c), (c + r, c), 5)
        pygame.draw.line(img, seam, (c, c - r), (c, c + r), 5)
        pygame.draw.arc(img, seam, (c - r - r // 2, c - r, r * 1.3, r * 2), -1.2, 1.2, 5)
        pygame.draw.arc(img, seam, (c + r - r * 0.8, c - r, r * 1.3, r * 2), math.pi - 1.2, math.pi + 1.2, 5)
        pygame.draw.circle(img, seam, (c, c), r, 5)
        return pygame.transform.smoothscale(img, (BALL_R * 2 + 2, BALL_R * 2 + 2))

    # --- hissələr ---------------------------------------------------------
    def draw_hoop_back(self, surf, hoop):
        s = hoop.side
        bx = hoop.board.x
        # dirək və dayaq
        pole_x = 6 if s < 0 else W - 20
        pygame.draw.rect(surf, (90, 95, 110), (pole_x, BOARD_BOTTOM, 14, FLOOR_Y - BOARD_BOTTOM))
        pygame.draw.rect(surf, (60, 64, 76), (pole_x, BOARD_BOTTOM, 14, FLOOR_Y - BOARD_BOTTOM), 2)
        pygame.draw.rect(surf, (60, 64, 76), (pole_x - 6, FLOOR_Y - 10, 26, 10))
        # lövhə
        pygame.draw.rect(surf, (245, 248, 255), hoop.board, border_radius=4)
        pygame.draw.rect(surf, (40, 40, 60), hoop.board, 3, border_radius=4)
        pygame.draw.rect(surf, (220, 40, 40), (bx + 8, RIM_Y - 58, BOARD_W - 16, 50), 3)

    def draw_hoop_front(self, surf, hoop, tick):
        lo, hi = hoop.lo, hoop.hi
        sway = math.sin(tick * 0.5) * hoop.net_timer / 10
        top = [lo + (hi - lo) * i / 6 for i in range(7)]
        bot_lo, bot_hi = lo + 14, hi - 14
        bottom = [bot_lo + (bot_hi - bot_lo) * i / 6 + sway for i in range(7)]
        net_c = (245, 245, 245)
        by = RIM_Y + NET_DEPTH + hoop.net_timer * 0.3
        for i in range(7):
            pygame.draw.line(surf, net_c, (top[i], RIM_Y), (bottom[6 - i], by), 2)
            pygame.draw.line(surf, net_c, (top[i], RIM_Y), (bottom[i], by), 1)
        for j in (1, 2):
            y = RIM_Y + (by - RIM_Y) * j / 3
            a = lo + (bot_lo - lo) * j / 3 + sway * j / 3
            b = hi + (bot_hi - hi) * j / 3 + sway * j / 3
            pygame.draw.line(surf, net_c, (a, y), (b, y), 1)
        pygame.draw.line(surf, COL_RIM, (hoop.board_face, RIM_Y), (hoop.front_x, RIM_Y), 7)
        pygame.draw.circle(surf, COL_RIM, (int(hoop.front_x), RIM_Y), RIM_R + 1)

    def draw_player(self, surf, p, ball):
        x, y, f = p.x, p.y, p.facing
        team = p.team
        # kölgə
        hgt = FLOOR_Y - y
        sw = max(30, 90 - hgt * 0.25)
        sh_surf = pygame.Surface((sw, 14), pygame.SRCALPHA)
        pygame.draw.ellipse(sh_surf, (0, 0, 0, 80), sh_surf.get_rect())
        surf.blit(sh_surf, (x - sw / 2, FLOOR_Y - 7))
        # ayaqlar
        leg_off = math.sin(pygame.time.get_ticks() * 0.02) * 5 if abs(p.vx) > 1 and p.on_ground else 0
        for i, dx in enumerate((-9, 9)):
            lx = x + dx + (leg_off if i else -leg_off)
            pygame.draw.line(surf, team["skin"], (x + dx, y - 34), (lx, y - 10), 9)
            pygame.draw.ellipse(surf, (30, 30, 36), (lx - 12 + f * 5, y - 14, 26, 14))
            pygame.draw.ellipse(surf, (240, 240, 240), (lx - 8 + f * 7, y - 12, 10, 6))
        # şort + forma
        pygame.draw.rect(surf, [int(c * 0.7) for c in team["jersey"]], (x - 20, y - 44, 40, 16),
                         border_radius=4)
        body = pygame.Rect(x - 22, y - 80, 44, 42)
        pygame.draw.rect(surf, team["jersey"], body, border_radius=10)
        pygame.draw.rect(surf, team["trim"], body, 3, border_radius=10)
        num = self.font_small.render("1" if p.side < 0 else "2", True, team["trim"])
        surf.blit(num, num.get_rect(center=body.center))
        # qol
        sx, sy = x + f * 14, y - 72
        if p.arm_anim > 0:
            k = p.arm_anim / 14  # qol yuxarı qalxır, sonra aşağı enir
            hx, hy = sx + f * (12 + 10 * (1 - k)), sy - 46 * k + 6
        else:
            hx, hy = sx + f * 16, sy + 30
        pygame.draw.line(surf, team["skin"], (sx, sy), (hx, hy), 9)
        pygame.draw.circle(surf, team["skin"], (int(hx), int(hy)), 7)
        # baş
        hx0, hy0 = x, y - HEAD_OFFSET
        pygame.draw.circle(surf, team["hair"], (int(hx0 - f * 2), int(hy0 - 5)), HEAD_R)
        pygame.draw.circle(surf, team["skin"], (int(hx0 + f * 3), int(hy0 + 4)), HEAD_R - 3)
        pygame.draw.circle(surf, (40, 30, 30), (int(hx0), int(hy0)), HEAD_R, 2)
        # saç bandı
        band = pygame.Rect(0, 0, HEAD_R * 2 - 4, 10)
        band.center = (hx0, hy0 - 16)
        pygame.draw.rect(surf, team["jersey"], band, border_radius=5)
        # qulaq
        pygame.draw.circle(surf, team["skin"], (int(hx0 - f * 30), int(hy0 + 4)), 8)
        pygame.draw.circle(surf, (40, 30, 30), (int(hx0 - f * 30), int(hy0 + 4)), 8, 1)
        # göz topa baxır
        ex, ey = hx0 + f * 16, hy0 + 2
        if p.blink > 0:
            pygame.draw.circle(surf, (255, 255, 255), (int(ex), int(ey)), 12)
            pygame.draw.circle(surf, (40, 30, 30), (int(ex), int(ey)), 12, 1)
            ang = math.atan2(ball.y - ey, ball.x - ex)
            pygame.draw.circle(surf, (30, 30, 40),
                               (int(ex + math.cos(ang) * 5), int(ey + math.sin(ang) * 5)), 6)
        else:
            pygame.draw.line(surf, (40, 30, 30), (ex - 10, ey), (ex + 10, ey), 3)
        pygame.draw.line(surf, (40, 30, 30), (ex - 11, ey - 16), (ex + 11, ey - 18 + f * 2), 4)
        # burun və ağız
        pygame.draw.circle(surf, [int(c * 0.9) for c in team["skin"]], (int(hx0 + f * 36), int(hy0 + 10)), 7)
        mouth = pygame.Rect(0, 0, 22, 14)
        mouth.center = (hx0 + f * 20, hy0 + 22)
        if p.arm_anim > 0 or not p.on_ground:
            pygame.draw.ellipse(surf, (120, 30, 40), mouth)
        else:
            pygame.draw.arc(surf, (60, 30, 30), mouth, math.pi + 0.3, 2 * math.pi - 0.3, 3)

    def draw_ball(self, surf, ball):
        sh = pygame.Surface((50, 12), pygame.SRCALPHA)
        a = int(clamp(90 - (FLOOR_Y - ball.y) * 0.15, 20, 90))
        pygame.draw.ellipse(sh, (0, 0, 0, a), sh.get_rect())
        surf.blit(sh, (ball.x - 25, FLOOR_Y - 6))
        img = pygame.transform.rotate(self.ball_img, ball.angle)
        surf.blit(img, img.get_rect(center=(int(ball.x), int(ball.y))))

    def text(self, surf, txt, font, color, center, shadow=True):
        if shadow:
            s = font.render(txt, True, (0, 0, 0))
            surf.blit(s, s.get_rect(center=(center[0] + 3, center[1] + 3)))
        img = font.render(txt, True, color)
        surf.blit(img, img.get_rect(center=center))

    def draw_hud(self, surf, game):
        p1, p2 = game.players
        panel = pygame.Rect(0, 0, 520, 86)
        panel.midtop = (W // 2, 10)
        s = pygame.Surface(panel.size, pygame.SRCALPHA)
        pygame.draw.rect(s, (10, 10, 20, 210), s.get_rect(), border_radius=16)
        surf.blit(s, panel)
        pygame.draw.rect(surf, (255, 150, 40), panel, 2, border_radius=16)
        pygame.draw.rect(surf, p1.team["jersey"], (panel.x + 14, panel.y + 14, 12, 58), border_radius=4)
        pygame.draw.rect(surf, p2.team["jersey"], (panel.right - 26, panel.y + 14, 12, 58), border_radius=4)
        self.text(surf, p1.name, self.font_small, COL_TEXT, (panel.x + 100, panel.y + 24), False)
        self.text(surf, p2.name, self.font_small, COL_TEXT, (panel.right - 100, panel.y + 24), False)
        self.text(surf, str(game.score[0]), self.font_mid, COL_GOLD, (panel.x + 100, panel.y + 60))
        self.text(surf, str(game.score[1]), self.font_mid, COL_GOLD, (panel.right - 100, panel.y + 60))
        if game.overtime:
            t = "ƏLAVƏ"
            col = (255, 90, 90)
        else:
            secs = max(0, math.ceil(game.time_left / FPS))
            t = f"{secs // 60}:{secs % 60:02d}"
            col = (255, 90, 90) if secs <= 10 else COL_TEXT
        self.text(surf, t, self.font_mid, col, (W // 2, panel.y + 45))

    def overlay(self, surf, alpha=150):
        s = pygame.Surface((W, H), pygame.SRCALPHA)
        s.fill((0, 0, 0, alpha))
        surf.blit(s, (0, 0))


# ---------------------------------------------------------------------------
# Əsas oyun
# ---------------------------------------------------------------------------
class Game:
    def __init__(self, screen, sound_on=True):
        self.screen = screen
        self.sounds = Sounds(sound_on)
        self.render = Renderer() if screen is not None else None
        self.state = "menu"
        self.menu_idx = 0
        self.opt_mode = 0  # 0: 1 oyunçu, 1: 2 oyunçu
        self.opt_diff = 1
        self.opt_time = 0
        self.tick = 0
        self.paused = False
        self.demo = False
        self.new_match()
        self.state = "menu"

    # --- matç idarəsi ------------------------------------------------------
    def new_match(self):
        self.world = World(self.sounds)
        two = self.opt_mode == 1 and not self.demo
        p1 = Player(-1, TEAMS[0], "CPU 1" if self.demo else "OYUNÇU 1")
        p2 = Player(1, TEAMS[1], "OYUNÇU 2" if two else "CPU")
        self.players = [p1, p2]
        self.world.players = self.players
        self.ais = [None, None if two else AI(p2, self.opt_diff)]
        if self.demo:
            self.ais[0] = AI(p1, self.opt_diff)
        self.score = [0, 0]
        self.time_left = DURATIONS[self.opt_time] * FPS
        self.overtime = False
        self.message = None
        self.msg_timer = 0
        self.stats = dict(shots=0, made=0)
        self.reset_positions(countdown=240)

    def reset_positions(self, countdown=60):
        for p in self.players:
            p.reset()
        self.world.ball.reset(W / 2 + random.uniform(-4, 4), 240, random.uniform(-1.2, 1.2), 0)
        self.state = "countdown"
        self.countdown = countdown
        self.last_count = None

    def on_score(self, hoop):
        scorer = 0 if hoop.side > 0 else 1
        b = self.world.ball
        pts = 3 if (b.three and b.shooter is self.players[scorer]) else 2
        self.score[scorer] += pts
        self.stats["made"] += 1
        self.sounds.play("score")
        self.message = ("ÜÇLÜK! +3" if pts == 3 else "SƏBƏT! +2", self.players[scorer].team["jersey"])
        self.msg_timer = 100
        self.state = "scored"
        self.celebrate = 100

    def finish(self):
        self.state = "over"
        self.sounds.play("buzzer")

    # --- giriş -------------------------------------------------------------
    def read_inputs(self, shoot_events):
        keys = pygame.key.get_pressed()
        two = self.opt_mode == 1
        p1 = dict(left=keys[pygame.K_a], right=keys[pygame.K_d], jump=keys[pygame.K_w],
                  shoot="p1" in shoot_events)
        p2 = dict(left=keys[pygame.K_LEFT], right=keys[pygame.K_RIGHT], jump=keys[pygame.K_UP],
                  shoot="p2" in shoot_events)
        if not two:
            p1 = {k: p1[k] or p2[k] for k in p1}
            p2 = {}
        return [p1, p2]

    # --- yeniləmə ----------------------------------------------------------
    def update(self, inputs):
        self.tick += 1
        w = self.world
        frozen = self.state == "countdown"
        for i, p in enumerate(self.players):
            ai = self.ais[i]
            inp = ai.think(w, self.players[1 - i]) if ai else inputs[i]
            p.update(inp, frozen=frozen)
            if inp.get("shoot") and not frozen:
                if try_shoot(p, w.ball, w.attack_hoop(p)):
                    self.stats["shots"] += 1
                    self.sounds.play("kick", 0.7)
        separate_players(*self.players)

        if self.state == "countdown":
            self.countdown -= 1
            n = math.ceil(self.countdown / 60)
            if n != self.last_count and n > 0 and self.countdown > 60:
                self.sounds.play("tick")
            self.last_count = n
            if self.countdown <= 0:
                self.state = "play"
                self.sounds.play("whistle")
            return

        scored = w.step_ball(allow_score=self.state == "play")
        if self.msg_timer > 0:
            self.msg_timer -= 1

        if self.state == "play":
            if scored:
                self.on_score(scored)
                return
            if not self.overtime:
                self.time_left -= 1
                if self.time_left <= 0:
                    if self.score[0] != self.score[1]:
                        self.finish()
                    else:
                        self.overtime = True
                        self.message = ("ƏLAVƏ VAXT! Növbəti səbət qalibdir", COL_GOLD)
                        self.msg_timer = 150
                        self.sounds.play("whistle")
        elif self.state == "scored":
            self.celebrate -= 1
            if self.celebrate <= 0:
                if self.overtime or (self.time_left <= 0 and self.score[0] != self.score[1]):
                    self.finish()
                else:
                    self.reset_positions()

    # --- çəkmə -------------------------------------------------------------
    def draw(self):
        r, s = self.render, self.screen
        s.blit(r.bg, (0, 0))
        if self.state == "menu":
            self.draw_menu()
            return
        w = self.world
        for hoop in w.hoops.values():
            r.draw_hoop_back(s, hoop)
        for p in self.players:
            r.draw_player(s, p, w.ball)
        r.draw_ball(s, w.ball)
        for hoop in w.hoops.values():
            r.draw_hoop_front(s, hoop, self.tick)
        r.draw_hud(s, self)

        if self.state == "countdown" and self.countdown > 0:
            n = math.ceil(self.countdown / 60)
            txt = str(n - 1) if n > 1 else "BAŞLA!"
            r.text(s, txt, r.font_big, COL_GOLD, (W // 2, H // 2 - 60))
        if self.msg_timer > 0 and self.message:
            txt, col = self.message
            y = H // 2 - 80 - (100 - min(self.msg_timer, 100)) * 0.3
            r.text(s, txt, r.font_big if len(txt) < 14 else r.font_mid, col, (W // 2, int(y)))
        if self.state == "over":
            self.draw_over()
        elif self.paused:
            r.overlay(s)
            r.text(s, "FASİLƏ", r.font_big, COL_TEXT, (W // 2, H // 2 - 60))
            r.text(s, "Esc / P - davam et      Q - menyu", r.font, COL_TEXT, (W // 2, H // 2 + 20))

    def draw_menu(self):
        r, s = self.render, self.screen
        r.overlay(s, 120)
        # dekorativ top
        t = pygame.time.get_ticks() / 1000
        bx = W // 2 + math.sin(t * 1.3) * 380
        by = 220 - abs(math.sin(t * 3)) * 60
        img = pygame.transform.rotozoom(r.ball_img, -t * 200, 1.6)
        s.blit(img, img.get_rect(center=(bx, by)))
        r.text(s, "HEAD BASKETBALL", r.font_big, (255, 150, 40), (W // 2, 120))
        items = [
            f"Rejim:  {'1 oyunçu (CPU-ya qarşı)' if self.opt_mode == 0 else '2 oyunçu'}",
            f"Çətinlik:  {DIFFICULTIES[self.opt_diff]}",
            f"Vaxt:  {DURATIONS[self.opt_time]} saniyə",
            "BAŞLA",
            "ÇIXIŞ",
        ]
        for i, it in enumerate(items):
            y = 300 + i * 58
            sel = i == self.menu_idx
            if sel:
                box = pygame.Rect(0, 0, 560, 50)
                box.center = (W // 2, y)
                pygame.draw.rect(s, (255, 150, 40), box, 3, border_radius=12)
            dim = self.opt_mode == 1 and i == 1
            col = (120, 120, 130) if dim else (COL_GOLD if sel else COL_TEXT)
            r.text(s, ("◀  " if sel and i < 3 else "") + it + ("  ▶" if sel and i < 3 else ""),
                   r.font, col, (W // 2, y))
        help1 = "Oyunçu 1:  A / D - hərəkət,  W - tullan,  Space / S - at"
        help2 = "Oyunçu 2:  ← / → - hərəkət,  ↑ - tullan,  Enter / ↓ - at"
        if self.opt_mode == 0:
            help1 = "İdarəetmə:  A/D və ya ←/→ - hərəkət,  W/↑ - tullan,  Space/Enter - at"
            help2 = "Topu başınla vur, səbətə at!  3 xal xəttinin arxasından atış = 3 xal"
        r.text(s, help1, r.font_small, (220, 220, 230), (W // 2, 620), False)
        r.text(s, help2, r.font_small, (220, 220, 230), (W // 2, 652), False)
        r.text(s, "F11 - tam ekran", r.font_small, (150, 150, 170), (W // 2, 690), False)

    def draw_over(self):
        r, s = self.render, self.screen
        r.overlay(s, 170)
        a, b = self.score
        if a == b:
            title, col = "HEÇ-HEÇƏ!", COL_TEXT
        else:
            win = self.players[0 if a > b else 1]
            title, col = f"{win.name} QALİB GƏLDİ!", win.team["jersey"]
        r.text(s, "OYUN BİTDİ", r.font_mid, COL_TEXT, (W // 2, H // 2 - 130))
        r.text(s, title, r.font_big, col, (W // 2, H // 2 - 50))
        r.text(s, f"{a}  :  {b}", r.font_big, COL_GOLD, (W // 2, H // 2 + 40))
        r.text(s, "Enter - yenidən oyna      Esc - menyu", r.font, COL_TEXT, (W // 2, H // 2 + 130))

    # --- menyu hadisələri --------------------------------------------------
    def menu_key(self, key):
        if key in (pygame.K_UP, pygame.K_w):
            self.menu_idx = (self.menu_idx - 1) % 5
        elif key in (pygame.K_DOWN, pygame.K_s):
            self.menu_idx = (self.menu_idx + 1) % 5
        elif key in (pygame.K_LEFT, pygame.K_RIGHT, pygame.K_a, pygame.K_d):
            d = 1 if key in (pygame.K_RIGHT, pygame.K_d) else -1
            if self.menu_idx == 0:
                self.opt_mode = (self.opt_mode + d) % 2
            elif self.menu_idx == 1:
                self.opt_diff = (self.opt_diff + d) % 3
            elif self.menu_idx == 2:
                self.opt_time = (self.opt_time + d) % len(DURATIONS)
            self.sounds.play("tick")
        elif key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE):
            if self.menu_idx == 3:
                self.new_match()
            elif self.menu_idx == 4:
                return False
            else:
                self.menu_key(pygame.K_RIGHT)
        elif key == pygame.K_ESCAPE:
            return False
        return True

    def run(self):
        clock = pygame.time.Clock()
        running = True
        while running:
            shoot_events = set()
            for ev in pygame.event.get():
                if ev.type == pygame.QUIT:
                    running = False
                elif ev.type == pygame.KEYDOWN:
                    if ev.key == pygame.K_F11:
                        try:
                            pygame.display.toggle_fullscreen()
                        except pygame.error:
                            pass
                    elif self.state == "menu":
                        running = self.menu_key(ev.key)
                    elif self.state == "over":
                        if ev.key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE):
                            self.new_match()
                        elif ev.key == pygame.K_ESCAPE:
                            self.state = "menu"
                    elif ev.key in (pygame.K_ESCAPE, pygame.K_p):
                        self.paused = not self.paused
                    elif self.paused and ev.key == pygame.K_q:
                        self.paused = False
                        self.state = "menu"
                    else:
                        if ev.key in (pygame.K_SPACE, pygame.K_s):
                            shoot_events.add("p1")
                        if ev.key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_DOWN):
                            shoot_events.add("p2" if self.opt_mode == 1 else "p1")
            if self.state not in ("menu", "over") and not self.paused:
                self.update(self.read_inputs(shoot_events))
            self.draw()
            pygame.display.flip()
            clock.tick(FPS)


# ---------------------------------------------------------------------------
# Giriş nöqtəsi
# ---------------------------------------------------------------------------
def self_test(matches=12):
    """Ekransız rejimdə CPU-ya qarşı CPU oyunu — fizika və qaydaları yoxlayır."""
    total_shots = total_made = 0
    for m in range(matches):
        g = Game(None, sound_on=False)
        g.demo = True
        g.opt_diff = m % 3
        g.new_match()
        frames = 0
        while g.state != "over" and frames < FPS * 400:
            g.update([{}, {}])
            b = g.world.ball
            assert math.isfinite(b.x) and math.isfinite(b.y), "top NaN oldu"
            assert -1 <= b.x <= W + 1 and -1 <= b.y <= FLOOR_Y + 1, f"top meydandan çıxdı: {b.x:.1f},{b.y:.1f}"
            for p in g.players:
                assert HEAD_R - 1 <= p.x <= W - HEAD_R + 1 and p.y <= FLOOR_Y + 0.01
            frames += 1
        total_shots += g.stats["shots"]
        total_made += g.stats["made"]
        print(f"Matç {m + 1} ({DIFFICULTIES[g.opt_diff]}): hesab {g.score[0]}:{g.score[1]}, "
              f"atış {g.stats['shots']}, səbət {g.stats['made']}, {frames / FPS:.0f} san")
        assert g.state == "over", "matç bitmədi"
    print(f"Cəmi: {total_shots} atış, {total_made} səbət — OK")


def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        os.environ["SDL_VIDEODRIVER"] = "dummy"
        pygame.init()
        self_test()
        return
    shot = None
    if "--screenshot" in args:
        os.environ["SDL_VIDEODRIVER"] = "dummy"
        shot = args[args.index("--screenshot") + 1]

    pygame.mixer.pre_init(22050, -16, 1, 512)
    pygame.init()
    pygame.display.set_caption("Head Basketball")
    try:
        flags = 0 if shot else pygame.SCALED | pygame.RESIZABLE
        screen = pygame.display.set_mode((W, H), flags)
    except pygame.error:
        screen = pygame.display.set_mode((W, H))
    game = Game(screen, sound_on=not shot)

    if shot:
        random.seed(3)
        game.demo = True
        game.new_match()
        for _ in range(60 * 9):
            game.update([{}, {}])
        game.draw()
        pygame.image.save(screen, shot)
        game.state = "menu"
        game.draw()
        root, ext = os.path.splitext(shot)
        pygame.image.save(screen, root + "_menu" + ext)
        print("saved", shot)
        return

    game.run()
    pygame.quit()


if __name__ == "__main__":
    main()
