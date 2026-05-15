package controller

import "callbackservice/framework"

type CaseService interface {
	Download()
}

type CaseServiceImpl struct{}

type CaseController struct {
	CaseService CaseService
}

func (c *CaseController) Download() {
	framework.CallService(c.CaseService.Download, nil)
}

func (*CaseServiceImpl) Download() {
	save()
}

func save() {}
