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
