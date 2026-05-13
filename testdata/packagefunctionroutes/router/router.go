package router

import (
	"packagefunctionroutes/service"

	"github.com/gin-gonic/gin"
)

func Build(engine *gin.Engine) {
	engine.GET("/ping", service.Ping)

	apiGroup := engine.Group("/api/v1")
	apiGroup.GET("/items", service.ListItems)
	apiGroup.POST("/items", createItem)
}

func createItem(c *gin.Context) {
	service.CreateItem(c)
}
