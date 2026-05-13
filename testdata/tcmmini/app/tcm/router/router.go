package router

import "github.com/gin-gonic/gin"

func InitGinRouter(r *gin.Engine) {
	apiV1Group := r.Group("/tcm/api/v1")
	initTestcasePlanRouter(apiV1Group)
}
