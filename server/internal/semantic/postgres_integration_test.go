package semantic

import (
	"context"
	"github.com/google/uuid"
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestSemanticPostgresReadOnly(t *testing.T) {
	dsn := os.Getenv("ENACT_SEMANTIC_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set ENACT_SEMANTIC_TEST_POSTGRES_DSN to an isolated PostgreSQL test database")
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	origin := "postgres://" + parsed.Host
	adapter := Adapter{AllowedOrigins: []string{origin}}
	connection := Connection{Kind: "postgres", Endpoint: origin}
	secret := Secret{DSN: dsn}
	result, err := adapter.Query(context.Background(), connection, secret, Binding{SQL: "SELECT $1::text AS subject", Arguments: []string{"subject"}}, map[string]any{"subject": "actual database"})
	if err != nil || !strings.Contains(string(result), "actual database") {
		t.Fatalf("read=%s err=%v", result, err)
	}
	name := "semantic_readonly_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = adapter.Query(context.Background(), connection, secret, Binding{SQL: "CREATE TABLE " + name + " (id int)"}, nil); err == nil {
		t.Fatal("read-only adapter permitted database DDL")
	}
}
