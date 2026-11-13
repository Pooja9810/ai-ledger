"""Generate two realistic but entirely FAKE bank statements for testing CSV import.

Usage: python3 samples/make_samples.py samples

Merchant names look like real statement text; all amounts, dates and people are made up.
Deterministic (seeded) so the files are the same every run.
"""
import csv
import random
import sys
from datetime import date, timedelta
from pathlib import Path

random.seed(2026)
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)

START, END = date(2026, 10, 1), date(2026, 11, 11)


def days():
    d = START
    while d <= END:
        yield d
        d += timedelta(days=1)


def money(cents):
    return f"{cents / 100:.2f}"


# ---------------------------------------------------------------- chequing
store = lambda: random.choice(["#1150", "#3329", "#0877", "#4521", "#2210"])
rows = []  # (date, description, withdrawal_cents, deposit_cents)
for d in days():
    if d.day == 1:
        rows.append((d, "E-TRANSFER SENT RENT J MORALES", 165000, 0))
    if d.weekday() == 4 and (d - date(2026, 10, 2)).days % 14 == 0:  # biweekly Fridays
        rows.append((d, "ACME CORP PAYROLL DEP", 0, 206250))
    if d.day == 5:
        rows.append((d, "HYDRO ONE NETWORKS PRE-AUTH", random.randint(9800, 12800), 0))
    if d.day == 8:
        rows.append((d, "ROGERS WIRELESS PAP", 8500, 0))
    if d.day == 12:
        rows.append((d, "ENBRIDGE GAS DISTRIBUTION", random.randint(4200, 7800), 0))
    if d.day == 15:
        rows.append((d, "VISA PAYMENT - THANK YOU", 60000, 0))
    if d.weekday() < 5 and random.random() < 0.55:
        rows.append((d, f"TIM HORTONS {store()} TORONTO ON", random.choice([215, 310, 425, 589]), 0))
    if d.weekday() in (2, 6):
        shop = random.choice([f"NO FRILLS {store()} TORONTO", f"LOBLAWS {store()}", "FRESHCO 0412"])
        rows.append((d, shop, random.randint(2400, 11800), 0))
    if random.random() < 0.18:
        rows.append((d, "PRESTO AUTOLOAD/TORONTO", 4000, 0))
    if random.random() < 0.08:
        rows.append((d, f"SHOPPERS DRUG MART {store()}", random.randint(899, 4599), 0))
    if random.random() < 0.06:
        rows.append((d, "LCBO/RAO #0217", random.randint(1795, 5490), 0))
    if random.random() < 0.05:
        rows.append((d, "ATM WITHDRAWAL - INTERAC", 6000, 0))
rows.append((date(2026, 10, 18), "E-TRANSFER RECEIVED P SINGH", 0, 4500))
rows.append((date(2026, 10, 22), "NO FRILLS #3329 TORONTO REFUND", 0, 1299))
rows.append((date(2026, 11, 3), "SERVICE CHARGE MONTHLY FEE", 1695, 0))
rows.sort(key=lambda r: r[0])

balance = 412_318
with open(out / "chequing-2026-10-11.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Date", "Description", "Withdrawals", "Deposits", "Balance"])
    for d, desc, wd, dep in rows:
        balance += dep - wd
        w.writerow([d.strftime("%m/%d/%Y"), desc, money(wd) if wd else "", money(dep) if dep else "", money(balance)])
print("chequing rows:", len(rows), "final balance:", money(balance))

# ---------------------------------------------------------------- visa
visa = []  # (transaction date, description, amount_cents: purchases POSITIVE)
for d in days():
    if d < date(2026, 11, 1):
        continue
    if random.random() < 0.35:
        visa.append((d, random.choice([
            "UBER CANADA/UBEREATS TORONTO",
            "DOORDASH*BURGER PRIEST, TORONTO",
            "SKIP THE DISHES WINNIPEG MB",
        ]), random.randint(1899, 4699)))
    if random.random() < 0.25:
        visa.append((d, "UBER CANADA/UBERTRIP TORONTO", random.randint(1150, 2890)))
    if random.random() < 0.2:
        visa.append((d, "AMZN MKTP CA*" + "".join(random.choices("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", k=7)), random.randint(1299, 8999)))
visa += [
    (date(2026, 11, 2), "NETFLIX.COM 866-579-7172 ON", 1899),
    (date(2026, 11, 3), "SPOTIFY P2F9A7C1D3", 1299),
    (date(2026, 11, 6), "CINEPLEX ENTERTAINMENT, TORONTO", 3150),
    (date(2026, 11, 9), "SHELL C12345 TORONTO ON", 6420),
    (date(2026, 11, 10), "WINNERS #0233, TORONTO", 4799),
    (date(2026, 11, 7), "AMZN MKTP CA RETURN", -2599),  # a refund: negative
    (date(2026, 11, 4), "PAYMENT - THANK YOU", -60000),  # the payment: negative
]
visa.sort(key=lambda r: r[0])


def dollars(cents):
    sign = "-" if cents < 0 else ""
    return f"{sign}${abs(cents) / 100:,.2f}"


with open(out / "visa-2026-11.csv", "w", newline="") as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL)
    w.writerow(["Transaction Date", "Posting Date", "Description", "Amount"])
    for d, desc, cents in visa:
        posted = d + timedelta(days=random.choice([0, 1, 1, 2]))
        w.writerow([d.isoformat(), posted.isoformat(), desc, dollars(cents)])
print("visa rows:", len(visa))
