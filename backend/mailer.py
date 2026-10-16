"""Email sending via SMTP (optional). Configure SMTP_HOST, SMTP_FROM, and optionally SMTP_PORT/USER/PASSWORD."""
import os
import smtplib
from email.message import EmailMessage


def is_configured() -> bool:
    return bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_FROM"))


def send_email(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = os.environ["SMTP_FROM"]
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    host, port = os.environ["SMTP_HOST"], int(os.getenv("SMTP_PORT", "587"))
    smtp = smtplib.SMTP_SSL(host, port, timeout=20) if port == 465 else smtplib.SMTP(host, port, timeout=20)
    with smtp as s:
        if port != 465:
            s.starttls()
        if os.getenv("SMTP_USER"):
            s.login(os.environ["SMTP_USER"], os.getenv("SMTP_PASSWORD", ""))
        s.send_message(msg)
