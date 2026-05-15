package router

import (
	"github.com/gin-gonic/gin"

	"callbackservice/controller"
)

var caseController *controller.CaseController

func Build(engine *gin.Engine) {
	engine.POST("/case/download", caseController.Download)
}
