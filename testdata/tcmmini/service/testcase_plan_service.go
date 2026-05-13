package service

import "context"

type TestcasePlanService interface {
	Create(c context.Context) error
}

type TestcasePlanServiceImpl struct{}

func NewTestcasePlanService() TestcasePlanService {
	return &TestcasePlanServiceImpl{}
}

func (s *TestcasePlanServiceImpl) Create(c context.Context) error {
	return nil
}
