const bcrypt = require('bcryptjs')
const { User, Tweet, Reply, Like } = require('../models')
const jwt = require('jsonwebtoken')
const { getUser } = require('../_helpers')
const Sequelize = require('sequelize')
const { Op, literal } = Sequelize
const { imgurFileHandler, localFileHandler } = require('../helpers/file-helpers')
const moment = require('moment')

const userController = {
  signUp: (req, res, next) => {
    const { name, account, email, password, checkPassword } = req.body
    // Error: 密碼不相符
    if (password !== checkPassword) throw new Error('Passwords do not match')
    // Error: 必填項目
    if (!account || account.trim() === '') throw new Error('帳號為必填項目')
    if (!email || email.trim() === '') throw new Error('Email為必填項目')
    if (!password || password.trim() === '') throw new Error('密碼為必填項目')
    // Error: 字數限制
    if (account.length > 20) throw new Error('Account 欄位上限 20 字')
    if (name.length > 50) throw new Error('Name 欄位上限 50 字')

    // 待設定password, name, account
    return User.findAll({
      [Op.or]: [{ where: { account } }, { where: { email } }],
    })
      .then((users) => {
        if (users.some((u) => u.email === email)) throw new Error('email已重複註冊')
        if (users.some((u) => u.account === account)) throw new Error('account已重複註冊')
        return bcrypt.hash(password, 10)
      })
      .then((hash) => {
        return User.create({
          name,
          account,
          email,
          password: hash,
          role: 'user',
        })
      })
      .then((newUser) => {
        const user = newUser.toJSON()
        delete user.password
        return res.status(200).json(user)
      })
      .catch((err) => next(err))
  },
  signIn: (req, res, next) => {
    const { account, password } = req.body
    if (!account || !password) throw new Error('Account and password is required')
    return User.findOne({
      where: { account },
    })
      .then((user) => {
        if (!user) throw new Error('使用者不存在')
        if (user.role === 'admin') throw new Error('使用者不存在')
        if (!bcrypt.compareSync(password, user.password)) throw new Error('密碼不相符')
        const userData = user.toJSON()
        delete userData.password
        const token = jwt.sign(userData, process.env.JWT_SECRET, {
          expiresIn: '30d',
        })
        return res.status(200).json({
          token,
          user: userData,
        })
      })
      .catch((err) => next(err))
  },
  getCurrentUser: (req, res, next) => {
    const result = getUser(req).toJSON()
    delete result.password
    delete result.Followers
    delete result.Followings

    return res.status(200).json(result)
  },
  getUserProfile: (req, res, next) => {
    const id = req.params.id || getUser(req).dataValues.id
    return User.findByPk(id, {
      raw: true,
      nest: true,
      attributes: {
        include: [
          [
            Sequelize.literal('(SELECT COUNT(DISTINCT id) FROM Followships WHERE Followships.following_id = User.id)'),
            'follower',
          ],
          [
            Sequelize.literal('(SELECT COUNT(DISTINCT id) FROM Followships WHERE Followships.follower_id = User.id)'),
            'following',
          ],
          [Sequelize.literal('(SELECT COUNT(id) FROM Tweets WHERE Tweets.user_id = User.id)'), 'tweetAmount'],
        ],
        exclude: ['password', 'createdAt', 'updatedAt'],
      },
    })
      .then((user) => {
        if (!user) throw new Error('帳號不存在！')
        if (user.role === 'admin') throw new Error('帳號不存在！')
        res.status(200).json(user)
      })
      .catch((err) => next(err))
  },
  putUserProfile: async (req, res, next) => {
    const fileHandler = process.env.NODE_ENV !== 'production' ? localFileHandler : imgurFileHandler
    if (getUser(req).id !== Number(req.params.id)) throw new Error('permission denied')
    return User.findByPk(req.params.id)
      .then((user) => {
        const { files } = req
        const { name, introduction } = req.body
        if (!user) throw new Error('帳號不存在！')
        // 判斷有沒有上傳東西
        if (JSON.stringify(files) !== '{}' && files !== undefined) {
          return Promise.all([fileHandler(files.cover), fileHandler(files.avatar)]).then(
            ([coverFilePath, avatarFilePath]) => {
              return user.update({
                name: name !== undefined ? req.body.name : user.toJSON().name,
                introduction: introduction !== undefined ? introduction : user.toJSON().introduction,
                cover: coverFilePath || user.toJSON().cover,
                avatar: avatarFilePath || user.toJSON().avatar,
              })
            }
          )
        } else {
          return user.update({
            name: name !== undefined ? name : user.toJSON().name,
            introduction: introduction !== undefined ? introduction : user.toJSON().introduction,
          })
        }
      })
      .then((updatedUser) => {
        delete updatedUser.dataValues.password
        res.status(200).json({
          status: 'success',
          message: '成功修改',
          updatedUser,
        })
      })
      .catch((err) => next(err))
  },

  getUserTweets: (req, res, next) => {
    return Promise.all([
      User.findByPk(req.params.id),
      Tweet.findAll({
        where: { userId: req.params.id },
        order: [['createdAt', 'DESC']],
        attributes: {
          include: [
            [
              literal(`(
                SELECT COUNT(*) 
                FROM replies AS reply
                WHERE 
                    reply.tweet_id = Tweet.id
                )`),
              'replyCount',
            ],
            [
              literal(`(
                SELECT COUNT(*) 
                FROM likes AS liked
                WHERE 
                    liked.tweet_id = Tweet.id
                )`),
              'likeCount',
            ],
          ],
          exclude: ['UserId'],
        },
        raw: true,
        nest: true,
      }),
    ])
      .then(([user, tweets]) => {
        // Error: user not found
        if (!user) throw new Error('No user found')
        // Error: tweets not found
        if (!tweets || tweets.length === 0) throw new Error('No tweets found')
        const processedTweets = tweets.map((tweet) => {
          const createdAt = moment(tweet.createdAt).format('YYYY-MM-DD HH:mm:ss')
          const updatedAt = moment(tweet.updatedAt).format('YYYY-MM-DD HH:mm:ss')
          const diffCreatedAt = moment().subtract(tweet.diffCreatedAt, 'seconds').fromNow()
          return {
            ...tweet,
            createdAt,
            updatedAt,
            diffCreatedAt,
          }
        })
        return res.status(200).json(processedTweets)
      })

      .catch((err) => next(err))
  },

  getUserRepliedTweets: (req, res, next) => {
    return Promise.all([
      User.findByPk(req.params.id),
      Reply.findAll({
        where: { userId: req.params.id },
        order: [['createdAt', 'DESC']],
        attributes: {
          include: [[Sequelize.literal(`TIMESTAMPDIFF(SECOND, Reply.created_at, NOW())`), 'diffCreatedAt']],
          exclude: ['UserId', 'TweetId'],
        },
        include: [
          {
            model: Tweet,
            include: [{ model: User, attributes: ['id', 'name', 'account', 'avatar'] }],
          },
        ],
        raw: true,
        nest: true,
      }),
    ])
      .then(([user, replies]) => {
        // Error: user not found
        if (!user) throw new Error('No user found')
        // Error: replies not found
        if (!replies || replies.length === 0) throw new Error('No replies found')

        const processedRepliedTweets = replies.map((reply) => {
          const createdAt = moment(reply.createdAt).format('YYYY-MM-DD HH:mm:ss')
          const updatedAt = moment(reply.updatedAt).format('YYYY-MM-DD HH:mm:ss')
          const diffCreatedAt = moment().subtract(reply.diffCreatedAt, 'seconds').fromNow()
          return {
            ...reply,
            createdAt,
            updatedAt,
            diffCreatedAt,
          }
        })

        return res.status(200).json(processedRepliedTweets)
      })
      .catch((err) => next(err))
  },

  getUserLikes: (req, res, next) => {
    return Promise.all([
      User.findByPk(req.params.id),
      Like.findAll({
        where: { UserId: req.params.id },
        order: [['createdAt', 'DESC']],
        include: [
          {
            model: Tweet,
            attributes: {
              include: [[Sequelize.literal(`TIMESTAMPDIFF(SECOND, Tweet.created_at, NOW())`), 'diffCreatedAt']],
              exclude: ['UserId'],
            },
            include: [{ model: User, attributes: ['id', 'name', 'account', 'avatar'] }],
          },
        ],
        raw: true,
        nest: true,
      }),
    ])
      .then(([user, likes]) => {
        // Error: user not found
        if (!user) throw new Error('No user found')
        // Error: likes not found
        if (!likes || likes.length === 0) throw new Error('No likes found')

        const processedUserLikes = likes.map((like) => {
          const createdAt = moment(like.Tweet.createdAt).format('YYYY-MM-DD HH:mm:ss')
          const updatedAt = moment(like.Tweet.updatedAt).format('YYYY-MM-DD HH:mm:ss')
          const diffCreatedAt = moment().subtract(like.Tweet.diffCreatedAt, 'seconds').fromNow()

          return {
            ...like,
            Tweet: {
              ...like.Tweet,
              createdAt,
              updatedAt,
              diffCreatedAt,
            },
          }
        })
        return res.status(200).json(processedUserLikes)
      })
      .catch((err) => next(err))
  },
  getFollowings: (req, res, next) => {
    return User.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'Followings',
          attributes: [['id', 'followingId'], 'name', 'account', 'avatar', 'cover', 'introduction'],
        },
      ],
      attributes: [['id', 'userId'], 'name', 'account', 'avatar', 'cover'],
    })
      .then((followings) => {
        if (followings.Followings.length === 0) return res.status(200).json({ isEmpty: true })
        const followingId = getUser(req).Followings.map((user) => user.id)
        const result = followings.Followings.map((f) => ({
          ...f.toJSON(),
          isFollowed: followingId.includes(f.toJSON().followingId) || false,
        })).sort((a, b) => b.Followship.createdAt.getTime() - a.Followship.createdAt.getTime())
        result.forEach((i) => delete i.Followship)
        return res.json(result)
      })
      .catch((err) => next(err))
  },
  getFollowers: (req, res, next) => {
    return User.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'Followers',
          attributes: [['id', 'followerId'], 'name', 'account', 'avatar', 'cover', 'introduction'],
        },
      ],
      attributes: [['id', 'userId'], 'name', 'account', 'avatar', 'cover'],
    })
      .then((followers) => {
        if (followers.Followers.length === 0) return res.status(200).json({ isEmpty: true })
        const followingId = getUser(req).Followings.map((user) => user.id)
        const result = followers.Followers.map((f) => ({
          ...f.toJSON(),
          isFollowed: followingId.includes(f.toJSON().followerId) || false,
        })).sort((a, b) => b.Followship.createdAt.getTime() - a.Followship.createdAt.getTime())
        result.forEach((i) => delete i.Followship)
        return res.json(result)
      })
      .catch((err) => next(err))
  },
}
module.exports = userController
