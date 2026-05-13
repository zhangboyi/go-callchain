package router

import (
	"tcmmini/app/tcm/controller"

	"github.com/gin-gonic/gin"
)

func initTestcasePlanRouter(group *gin.RouterGroup) {
	co := controller.NewTestcasePlanController()
	group.POST("/testcase_plans", co.Create)
}
