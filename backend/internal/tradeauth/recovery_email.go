package tradeauth

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"

	"github.com/marketlens/backend/internal/config"
)

const recoverySMTPTimeout = 15 * time.Second

type smtpRecoveryEmailSender struct {
	host     string
	port     int
	username string
	password string
	mode     string
	from     mail.Address
}

func newSMTPRecoveryEmailSender(cfg config.Config) RecoveryEmailSender {
	if !cfg.TradeRecoveryEmailConfigured() {
		return nil
	}
	if cfg.TradeRecoverySMTPMode != "starttls" &&
		cfg.TradeRecoverySMTPMode != "tls" &&
		cfg.TradeRecoverySMTPMode != "plain" {
		return nil
	}
	if cfg.TradeRecoverySMTPMode == "plain" {
		ip := net.ParseIP(cfg.TradeRecoverySMTPHost)
		if cfg.IsProduction() ||
			(cfg.TradeRecoverySMTPHost != "localhost" && (ip == nil || !ip.IsLoopback())) ||
			cfg.TradeRecoverySMTPUser != "" {
			return nil
		}
	}
	from, err := mail.ParseAddress(cfg.TradeRecoveryEmailFrom)
	if err != nil {
		return nil
	}
	return &smtpRecoveryEmailSender{
		host:     cfg.TradeRecoverySMTPHost,
		port:     cfg.TradeRecoverySMTPPort,
		username: cfg.TradeRecoverySMTPUser,
		password: cfg.TradeRecoverySMTPPass,
		mode:     cfg.TradeRecoverySMTPMode,
		from:     *from,
	}
}

func (s *smtpRecoveryEmailSender) SendTradePasswordRecoveryCode(
	ctx context.Context,
	email, code string,
	expiresAt time.Time,
) error {
	recipient, err := mail.ParseAddress(email)
	if err != nil || recipient.Address == "" {
		return fmt.Errorf("invalid recovery recipient")
	}
	address := net.JoinHostPort(s.host, fmt.Sprintf("%d", s.port))
	dialer := &net.Dialer{Timeout: recoverySMTPTimeout}
	tlsConfig := &tls.Config{ServerName: s.host, MinVersion: tls.VersionTLS12}

	var connection net.Conn
	if s.mode == "tls" {
		connection, err = (&tls.Dialer{NetDialer: dialer, Config: tlsConfig}).DialContext(
			ctx,
			"tcp",
			address,
		)
	} else {
		connection, err = dialer.DialContext(ctx, "tcp", address)
	}
	if err != nil {
		return err
	}
	defer connection.Close()
	deadline := time.Now().Add(recoverySMTPTimeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err = connection.SetDeadline(deadline); err != nil {
		return err
	}

	client, err := smtp.NewClient(connection, s.host)
	if err != nil {
		return err
	}
	defer client.Close()
	if s.mode == "starttls" {
		if supported, _ := client.Extension("STARTTLS"); !supported {
			return fmt.Errorf("SMTP server does not support STARTTLS")
		}
		if err = client.StartTLS(tlsConfig); err != nil {
			return err
		}
	}
	if s.username != "" {
		if err = client.Auth(smtp.PlainAuth("", s.username, s.password, s.host)); err != nil {
			return err
		}
	}
	if err = client.Mail(s.from.Address); err != nil {
		return err
	}
	if err = client.Rcpt(recipient.Address); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	message := recoveryEmailMessage(s.from, *recipient, code, expiresAt)
	if _, err = io.WriteString(writer, message); err != nil {
		_ = writer.Close()
		return err
	}
	if err = writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func recoveryEmailMessage(
	from, to mail.Address,
	code string,
	expiresAt time.Time,
) string {
	subject := mime.QEncoding.Encode("utf-8", "Mã khôi phục mật khẩu giao dịch MarketLens")
	minutes := int(time.Until(expiresAt).Round(time.Minute) / time.Minute)
	if minutes < 1 {
		minutes = 10
	}
	body := fmt.Sprintf(
		"Dùng mã xác nhận sau để đặt lại mật khẩu giao dịch MarketLens:\r\n\r\n%s\r\n\r\nMã hết hạn sau %d phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.\r\n\r\n---\r\n\r\nUse this confirmation code to reset your MarketLens trade password:\r\n\r\n%s\r\n\r\nThis code expires in %d minutes. If you did not request it, you can ignore this email.\r\n",
		code,
		minutes,
		code,
		minutes,
	)
	return strings.Join([]string{
		"From: " + from.String(),
		"To: " + to.String(),
		"Subject: " + subject,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		body,
	}, "\r\n")
}
