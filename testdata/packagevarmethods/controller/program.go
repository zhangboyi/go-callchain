package controller

import "github.com/gin-gonic/gin"

var programService ProgramService

type CreateRequest struct{}

func (CreateRequest) Validate() {}

type ProgramService struct{}

func CreateProgram(c *gin.Context) {
	var request CreateRequest
	request.Validate()
	programService.CreateProgram(c)
}

func (*ProgramService) CreateProgram(c *gin.Context) {
	saveProgram()
}

func saveProgram() {}
