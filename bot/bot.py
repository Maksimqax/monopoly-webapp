#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Монополия — локальный бот (polling) с кнопкой-ссылкой.
Открывает локальный WebApp по адресу http://127.0.0.1:8000/webapp
"""

import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

# ВСТАВЛЕННЫЙ ТОКЕН ОТ ПОЛЬЗОВАТЕЛЯ
BOT_TOKEN = "8257515736:AAGAFzjzNM9q85OA6AFJR6CeuBOQhgXyQmU"

PUBLIC_URL = "http://127.0.0.1:8000/webapp"  # локальная страница WebApp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s"
)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = InlineKeyboardMarkup([[InlineKeyboardButton("🎲 Открыть игру", url=PUBLIC_URL)]])
    await update.message.reply_text("Монополия (локально). Жми кнопку:", reply_markup=kb)

async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("/start — открыть ссылку на игру\n/room <id> — ссылка на комнату (добавлю позже)")

def main():
    if not BOT_TOKEN:
        raise SystemExit("Нет токена!")
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_cmd))
    logging.info("Bot starting (polling)…")
    app.run_polling()

if __name__ == "__main__":
    main()
