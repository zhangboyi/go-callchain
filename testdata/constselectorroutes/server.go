package constselectorroutes

import (
	"github.com/gin-gonic/gin"

	"constselectorroutes/consts"
	"constselectorroutes/recurring"
)

type Server struct {
	RecurringRouter recurring.Router
}

func (s Server) registerRouters(e *gin.Engine) {
	g := e.Group(consts.OpsPrefix + consts.HTTPPathVersion)
	recurringG := g.Group(consts.HTTPPathRecurring)
	s.RecurringRouter.AddRoutes(recurringG)
}
