package router

import (
	"github.com/gin-gonic/gin"

	"packagevarmethods/controller"
)

func Build(engine *gin.Engine) {
	engine.POST("/program/create", controller.CreateProgram)
}
