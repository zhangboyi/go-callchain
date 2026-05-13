package router

import (
	"github.com/gin-gonic/gin"

	"receiverroutes/handler"
)

type Router struct {
	item *handler.ItemHandler
}

func (r *Router) AddRoutes(g *gin.Engine) {
	group := g.Group("/api/admin")
	items := group.Group("/items")
	items.POST("/create", r.item.Create)
}
