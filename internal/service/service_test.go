package service

import (
	"testing"

	"go-callchain-service/internal/model"
)

func TestAppendUniqueImpactKeepsOneRowPerInterfaceAndChangedFunction(t *testing.T) {
	index := map[string]int{}
	items := []model.ImpactedInterface{}

	items = appendUniqueImpact(items, index, model.ImpactedInterface{
		Method:          "DELETE",
		Path:            "/items/:id",
		Handler:         "controller.Delete",
		ChangedFunction: "service.Delete",
		Chain:           []string{"controller.Delete", "view.Delete", "service.Delete"},
		Risk:            "indirect",
	})
	items = appendUniqueImpact(items, index, model.ImpactedInterface{
		Method:          "DELETE",
		Path:            "/items/:id",
		Handler:         "controller.Delete",
		ChangedFunction: "service.Delete",
		Chain:           []string{"controller.Delete", "service.Delete"},
		Risk:            "indirect",
	})

	if len(items) != 1 {
		t.Fatalf("items length = %d", len(items))
	}
	if got := len(items[0].Chain); got != 2 {
		t.Fatalf("chain length = %d", got)
	}
}

func TestResolveFunctionAcceptsSuffixID(t *testing.T) {
	functions := []model.Function{
		{
			ID:   "git.garena.com/shopee/seller-server/seller-governance/brand_ip_protection/internal/controller.(APIOrgController).GetAccessReviewBanner",
			Name: "GetAccessReviewBanner",
		},
	}

	got, err := resolveFunction(functions, "seller-governance/brand_ip_protection/internal/controller.(APIOrgController).GetAccessReviewBanner")
	if err != nil {
		t.Fatalf("resolve function: %v", err)
	}
	if got.ID != functions[0].ID {
		t.Fatalf("resolved id = %s", got.ID)
	}
}

func TestResolveFunctionRejectsAmbiguousSuffixID(t *testing.T) {
	functions := []model.Function{
		{ID: "repo/a/service.(Service).Run"},
		{ID: "repo/b/service.(Service).Run"},
	}

	if _, err := resolveFunction(functions, "service.(Service).Run"); err == nil {
		t.Fatal("expected ambiguous function error")
	}
}
