package service

import "github.com/gin-gonic/gin"

func Ping(c *gin.Context) {
}

func ListItems(c *gin.Context) {
	loadItems()
}

func CreateItem(c *gin.Context) {
	saveItem()
}

func loadItems() {
}

func saveItem() {
}
