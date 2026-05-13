package view

import (
	"context"
	"tcmmini/service"
)

type TestcasePlanView interface {
	Create(c context.Context) error
}

type TestcasePlanViewImpl struct {
	testcasePlanService service.TestcasePlanService
}

func NewTestcasePlanView() TestcasePlanView {
	return &TestcasePlanViewImpl{
		testcasePlanService: service.NewTestcasePlanService(),
	}
}

func (v *TestcasePlanViewImpl) Create(c context.Context) error {
	return v.testcasePlanService.Create(c)
}
