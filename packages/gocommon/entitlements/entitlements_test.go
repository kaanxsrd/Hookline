package entitlements_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/kaanxsrd/hookline/packages/gocommon/entitlements"
)

func ptr(s string) *string { return &s }

func TestPlansMatchSpec(t *testing.T) {
	free := entitlements.For(entitlements.PlanFree)
	assert.Equal(t, int64(3), free.Endpoints)
	assert.Equal(t, int64(5000), free.RequestsPerMonth)
	assert.Equal(t, int64(256<<10), free.MaxBodyBytes)
	assert.Equal(t, int64(24), free.RetentionHours)

	pro := entitlements.For(entitlements.PlanPro)
	assert.Equal(t, int64(5<<20), pro.MaxBodyBytes)
	assert.Equal(t, int64(14*24), pro.RetentionHours)

	team := entitlements.For(entitlements.PlanTeam)
	assert.Equal(t, int64(10<<20), team.MaxBodyBytes)
	assert.Equal(t, entitlements.Unlimited, team.Members)

	anon := entitlements.For(entitlements.PlanAnonymous)
	assert.Equal(t, int64(0), anon.DestinationsPerEndpoint)
	assert.Equal(t, int64(100), entitlements.Anonymous().MaxRequests)
	assert.Equal(t, int64(24), entitlements.Anonymous().ExpiryHours)
}

func TestUnknownPlanFallsBackToFree(t *testing.T) {
	assert.Equal(t, entitlements.For(entitlements.PlanFree), entitlements.For("platinum"))
}

func TestWithin(t *testing.T) {
	assert.True(t, entitlements.Within(3, 3))
	assert.False(t, entitlements.Within(3, 4))
	assert.True(t, entitlements.Within(entitlements.Unlimited, 1<<40))
}

func TestResolve(t *testing.T) {
	tests := []struct {
		name     string
		instance entitlements.Plan
		hasOrg   bool
		plan     *string
		override *string
		want     entitlements.Plan
	}{
		{"instance override wins", entitlements.PlanUnlimited, false, nil, nil, entitlements.PlanUnlimited},
		{"no org is anonymous", "", false, ptr("team"), nil, entitlements.PlanAnonymous},
		{"admin override", "", true, ptr("free"), ptr("team"), entitlements.PlanTeam},
		{"subscribed plan", "", true, ptr("pro"), nil, entitlements.PlanPro},
		{"no subscription row", "", true, nil, nil, entitlements.PlanFree},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, entitlements.Resolve(tt.instance, tt.hasOrg, tt.plan, tt.override))
		})
	}
}
