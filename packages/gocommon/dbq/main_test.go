package dbq_test

import (
	"os"
	"testing"

	"github.com/kaanxsrd/hookline/packages/gocommon/dbtest"
)

func TestMain(m *testing.M) { os.Exit(dbtest.Run(m)) }
