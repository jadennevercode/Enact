// account-source-credentials transfers only one account's semantic connection
// secrets. Run inside the source backend container: its instance key never
// leaves the process. Output is authenticated encryption under a separate key
// supplied on stdin, matching scripts/account-bundle.mjs.
package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/util/secretbox"
	"github.com/jackc/pgx/v5"
)

func run(email string) error {
	if email == "" {
		return fmt.Errorf("--email is required")
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 128))
	if err != nil {
		return err
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(key) != 32 {
		return fmt.Errorf("stdin must contain a 32-byte base64 transfer key")
	}
	instanceKey, err := secretbox.LoadKey("ENACT_SEMANTIC_SECRET_KEY")
	if err != nil {
		return err
	}
	box, err := secretbox.New(instanceKey)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return fmt.Errorf("source database connection failed")
	}
	defer conn.Close(ctx)
	rows, err := conn.Query(ctx, `SELECT c.id::text, c.secret FROM semantic_connection c
		JOIN member m ON m.workspace_id=c.workspace_id JOIN "user" u ON u.id=m.user_id
		WHERE lower(u.email)=lower($1) AND c.secret IS NOT NULL`, email)
	if err != nil {
		return fmt.Errorf("source connection lookup failed")
	}
	defer rows.Close()
	secrets := map[string]json.RawMessage{}
	for rows.Next() {
		var id string
		var encrypted []byte
		if err := rows.Scan(&id, &encrypted); err != nil {
			return err
		}
		plain, err := box.Open(encrypted)
		if err != nil || !json.Valid(plain) {
			return fmt.Errorf("invalid credential for connection %s", id)
		}
		secrets[id] = plain
	}
	if err := rows.Err(); err != nil {
		return err
	}
	data, err := json.Marshal(secrets)
	if err != nil {
		return err
	}
	var compressed bytes.Buffer
	zip := gzip.NewWriter(&compressed)
	if _, err := zip.Write(data); err != nil {
		return err
	}
	if err := zip.Close(); err != nil {
		return err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	header := []byte("ENACTB01")
	output := append(append([]byte{}, header...), nonce...)
	output = aead.Seal(output, nonce, compressed.Bytes(), header)
	_, err = os.Stdout.Write(output)
	return err
}

func main() {
	email := flag.String("email", "", "account whose Source credentials are authorized for transfer")
	flag.Parse()
	if err := run(*email); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
