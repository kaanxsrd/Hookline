// Package entitlements answers "what is this organization allowed to do".
// The limits live in config/plans.json; plans_gen.go is generated from it by
// `bun run gen`, and the TypeScript side (packages/shared) is generated from
// the same file, so both languages always agree.
package entitlements

// Plan names a set of limits.
type Plan string

// Plans. Anonymous applies to endpoints created without an account;
// Unlimited is for self-hosted instances (PLAN_OVERRIDE=unlimited).
const (
	PlanFree      Plan = "free"
	PlanPro       Plan = "pro"
	PlanTeam      Plan = "team"
	PlanAnonymous Plan = "anonymous"
	PlanUnlimited Plan = "unlimited"
)

// Unlimited marks a limit that does not apply (null in plans.json).
const Unlimited int64 = -1

// Limits are the quotas of one plan. A value of Unlimited means no limit.
type Limits struct {
	Name                    string
	Endpoints               int64
	RequestsPerMonth        int64
	RetentionHours          int64
	MaxBodyBytes            int64
	DestinationsPerEndpoint int64
	ConcurrentTunnels       int64
	Members                 int64
	AuditLogDays            int64
	IntakeRatePerSecond     int64
	IntakeBurst             int64
}

// AnonymousRules govern endpoints created without an account.
type AnonymousRules struct {
	ExpiryHours          int64
	MaxRequests          int64
	EndpointsPerIPPerDay int64
}

// IntakeRules are instance-wide intake limits independent of plans.
type IntakeRules struct {
	PerIPRatePerSecond int64
	PerIPBurst         int64
}

// For returns the limits of p. Unknown plans fall back to Free, the most
// restrictive paid-account plan, so a bad value can never grant more.
func For(p Plan) Limits {
	if l, ok := plans[p]; ok {
		return l
	}
	return plans[PlanFree]
}

// Anonymous returns the rules for anonymous endpoints.
func Anonymous() AnonymousRules { return anonymousRules }

// Intake returns the instance-wide intake rules.
func Intake() IntakeRules { return intakeRules }

// Within reports whether n stays within limit.
func Within(limit, n int64) bool {
	return limit == Unlimited || n <= limit
}

// Resolve picks the plan in force for an endpoint's owner:
//  1. an instance-wide override (PLAN_OVERRIDE=unlimited on self-hosted instances),
//  2. no organization: anonymous,
//  3. the organization's administrator override,
//  4. the organization's subscribed plan, defaulting to free.
func Resolve(instanceOverride Plan, hasOrg bool, orgPlan, orgOverride *string) Plan {
	if instanceOverride != "" {
		return instanceOverride
	}
	if !hasOrg {
		return PlanAnonymous
	}
	if orgOverride != nil && *orgOverride != "" {
		return Plan(*orgOverride)
	}
	if orgPlan != nil && *orgPlan != "" {
		return Plan(*orgPlan)
	}
	return PlanFree
}
