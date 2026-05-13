package recurring

import "github.com/gin-gonic/gin"

type Router struct {
	*routerParams
}

type routerParams struct {
	Ops *Ops
}

func (r Router) AddRoutes(g *gin.RouterGroup) {
	g.POST("/mission/list", r.Ops.ListMission)
}

type Ops struct{}

func (Ops) ListMission() {}
