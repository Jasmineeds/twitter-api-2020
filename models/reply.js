'use strict'
const { Model } = require('sequelize')
module.exports = (sequelize, DataTypes) => {
  class Reply extends Model {
    static associate (models) {
      Reply.belongsTo(models.Tweet, { foreignKey: 'TweetId' })
      Reply.belongsTo(models.User, { foreignKey: 'UserId' })
    }
  }
  Reply.init(
    {
      userId: DataTypes.INTEGER,
      tweetId: DataTypes.INTEGER,
      comment: DataTypes.TEXT
    },
    {
      sequelize,
      modelName: 'Reply',
      tableName: 'Replies',
      underscored: true
    }
  )
  return Reply
}
