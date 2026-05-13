package controller

import (
	"tcmmini/app/tcm/view"

	"github.com/gin-gonic/gin"
)

type TestcasePlanController struct {
	testcasePlanView view.TestcasePlanView
}

func NewTestcasePlanController() *TestcasePlanController {
	return &TestcasePlanController{
		testcasePlanView: view.NewTestcasePlanView(),
	}
}

func (co *TestcasePlanController) Create(c *gin.Context) {
	co.testcasePlanView.Create(c)
}
