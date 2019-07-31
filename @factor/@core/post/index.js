export default Factor => {
  return new (class {
    constructor() {
      this.filters()

      this.initialized = false
    }

    async request(method, params) {
      return await Factor.$endpoint.request({ id: "posts", method, params })
    }

    async save({ post, postType }) {
      return await this.request("save", { data: post, postType })
    }

    filters() {
      Factor.$filters.add("components", _ => {
        _["factor-post-edit"] = () => import("./el/edit-link")
        return _
      })

      Factor.$filters.add("dashboard-routes", _ => {
        _.push({
          path: "posts",
          component: () => import("./dashboard-list")
        })

        _.push({
          path: "posts/edit",
          component: () => import("./dashboard-edit")
          // meta: { activePath: "/admin/posts" }
        })

        _.push({
          path: "posts/:postType/edit",
          component: () => import("./dashboard-edit")
          //meta: { activePath: "/admin/posts" }
        })

        _.push({
          path: "posts/:postType/add-new",
          component: () => import("./dashboard-edit"),
          meta: {}
        })

        _.push({
          path: "posts/:postType",
          component: () => import("./dashboard-list"),
          meta: {}
        })

        return _
      })

      // Assign Post Info to Route
      // Has to happen after all initialized
      // Factor.$filters.add("mixins", _ => {
      //   //_.post = this.addPostToComponents()

      //   return _
      // })

      Factor.$filters.callback("site-prefetch", _ => this.prefetchPost(_))
      Factor.$filters.callback("client-route-before-promises", _ => this.prefetchPost(_))

      Factor.$filters.add("admin-menu", _ => {
        this.getPostTypes().forEach(
          ({ type, namePlural, icon = "", add = "add-new", accessLevel }) => {
            const subMenu = []

            if (add) {
              subMenu.push({
                path: add,
                name: Factor.$utils.toLabel(add)
              })
            }

            subMenu.push({
              path: "edit"
            })

            if (!accessLevel || Factor.$user.can({ accessLevel })) {
              _.push({
                group: type,
                path: `posts/${type}`,
                name: namePlural || Factor.$utils.toLabel(type),
                icon,
                items: Factor.$filters.apply(`admin-menu-post-${type}`, subMenu)
              })
            }
          }
        )

        return _
      })
    }

    async prefetchPost({ to = null } = {}) {
      const route = to || Factor.$router.currentRoute

      const request = Factor.$filters.apply("post-params", {
        ...route.params,
        ...route.query
      })

      const { permalink, _id } = request

      // Only add to the filter if permalink is set. That way we don't show loader for no reason.
      if (!permalink && !_id) return {}

      const _post = await this.getSinglePost(request)

      Factor.$store.add("post", _post)

      return _post
    }

    addPostToComponents() {
      return () => {
        Factor.mixin({
          computed: {
            $post() {
              return this.current()
            }
          }
        })
      }
    }

    current() {
      return this.$store.getters["getItem"]("post") || {}
    }

    init(cb) {
      if (this.initialized) {
        cb()
      } else {
        Factor.$events.$on("postInit", () => {
          this.initialized = true
          cb()
        })
      }
    }

    getMetatags({ post = {}, parts }) {
      const metatags = {}

      const canonical = this.getPermalink(parts)

      const title = post.titleTag || post.title || ""
      const description = post.description || this.excerpt(post.content) || ""
      const image = post.featuredImage
        ? post.featuredImage[0].url
        : post.images
        ? post.images[0].url
        : ""

      return { canonical, title, description, image }
    }

    async getPostById({ _id, postType = "post", createOnEmpty = false }) {
      const _post = await this.request("single", { _id, postType, createOnEmpty })

      if (_post) {
        Factor.$store.add(_post._id, _post)
      }

      return _post
    }

    async getList(args) {
      const { posts } = await this.request("list", args)

      return posts
    }

    async getSinglePost(args) {
      const {
        permalink,
        field = "permalink",
        postType = "post",
        _id,
        token,
        createOnEmpty = false,
        depth = 10
      } = args

      const params = { postType, createOnEmpty }

      if (_id) {
        params._id = _id
      } else if (token) {
        params.token = token
      } else {
        params.conditions = { [field]: permalink }
      }

      const post = await this.request("single", params)

      if (post) {
        Factor.$store.add(post._id, post)
        await this.populateOneRecursively({ post, postType, depth })
      }

      return post
    }

    async getPostIndex(args) {
      const { limit = 20, page = 1, postType } = args

      const taxonomies = ["tag", "category", "status", "role"]

      const conditions = {}
      taxonomies.forEach(_ => {
        if (args[_]) {
          conditions[_] = args[_]
        }
      })

      if (!args.status) {
        conditions.status = { $ne: "trash" }
      }

      const skip = (page - 1) * limit

      const indexData = await this.request("list", {
        postType,
        conditions,
        options: { limit, skip, page }
      })

      Factor.$store.add(postType, indexData)

      this.populateManyRecursively({ posts: indexData.posts })

      return indexData
    }

    async populateManyRecursively({ posts, depth = 10 }) {
      const promises = posts.map(p =>
        this.populateOneRecursively({ post: p, postType: p.postType, depth })
      )

      await Promise.all(promises)
    }

    async populateOneRecursively({ post, postType, depth = 10 }) {
      Factor.$store.add(post._id, post)
      let _ids = []
      const populatedFields = Factor.$mongo.getPopulatedFields({ postType, depth })
      populatedFields.forEach(f => {
        const v = post[f]
        if (v) {
          if (Array.isArray(v)) {
            _ids = [..._ids, ...v]
          } else {
            _ids.push(v)
          }
        }
      })

      const filtered = _ids.filter(_id => {
        const storeVal = Factor.$store.val(_id)

        return !storeVal
      })

      if (filtered.length > 0) {
        const posts = await Factor.$db.request("populate", { _ids: filtered })
        await this.populateManyRecursively({ posts, depth })
      }
    }

    getPostTypes() {
      return Factor.$filters.apply("post-types", []).map(_ => {
        return {
          base: typeof _.base == "undefined" ? _.type : _.base,
          nameIndex: Factor.$utils.toLabel(_.type),
          nameSingle: Factor.$utils.toLabel(_.type),
          namePlural: Factor.$utils.toLabel(_.type),
          ..._
        }
      })
    }

    postTypeMeta(postType) {
      const postTypes = this.getPostTypes()

      return postTypes.find(pt => pt.type == postType)
    }

    populatedFields({ postType, depth = 10 }) {
      return Factor.$mongo.getPopulatedFields({ postType, depth })
    }

    getPermalink({ type, permalink = "", root = true, path = false } = {}) {
      const parts = []

      parts.push(root ? Factor.$config.setting("url") : "")

      if (path) {
        parts.push(path)
        return parts.join("").replace(/\/$/, "") // remove trailing backslash
      } else {
        if (type) {
          const pt = this.getPostTypes().find(_ => _.type == type)

          const base = pt ? pt.base : false

          if (base) {
            parts.push(base)
          }
        }

        parts.push(permalink)

        return parts.join("/")
      }
    }

    // Get the count of posts with a given status (or similar)
    // Null values (e.g. status is unset) should be given the value assigned by nullKey
    // Use in table control filtering
    getStatusCount({ meta, field = "status", key, nullKey = false }) {
      if (!meta[field]) {
        return 0
      }

      let count
      const result = meta[field].find(_ => _._id == key)

      count = result ? result.count : 0
      if (nullKey && key == nullKey) {
        const nullsCount = meta[field].find(_ => _._id == null)
        count += nullsCount ? nullsCount.count : 0
      }
      return count
    }

    // Limit saved revisions to 20 and one per hour after first hour
    _cleanRevisions(revisions = []) {
      let counter

      const cleanedRevisions = revisions
        .filter(rev => {
          if (
            counter &&
            rev.timestamp > counter - 3600 &&
            rev.timestamp < Factor.$time.stamp() - 3600
          ) {
            return false
          } else {
            counter = rev.timestamp
            return true
          }
        })
        .slice(0, 20)

      return cleanedRevisions
    }

    // Save revisions to post
    // This should be merged into existing post (update)
    async saveDraft({ id, revisions }) {
      const data = {
        revisions: this._cleanRevisions(revisions) // limit amount and frequency
      }
      const query = {
        model: "post",
        method: "findByIdAndUpdate",
        data,
        id
      }

      const response = await Factor.$db.run(query)

      console.log("[draft saved]", query, data, revisions)

      return response
    }

    // Verify a permalink is unique,
    // If not unique, then add number and recursively verify the new one
    async permalinkVerify({ permalink, id, field = "permalink" }) {
      const post = await this.getSinglePost({ permalink, field })

      if (post && post.id != id) {
        Factor.$events.$emit(
          "notify",
          `${Factor.$utils.toLabel(field)} "${permalink}" already exists.`
        )
        let num = 1
        var matches = permalink.match(/\d+$/)
        if (matches) {
          num = parseInt(matches[0]) + 1
        }
        permalink = await this.permalinkVerify({
          permalink: `${permalink.replace(/\d+$/, "")}${num}`,
          id
        })
      }
      return permalink
    }

    async savePost(post) {
      let data = Object.assign({}, post)
      const { id } = data
      data.permalink = await this.permalinkVerify({ permalink: data.permalink, id })
      data = await this.addRevision({ post: data, meta: { published: true } })

      const query = {
        collection: "public",
        data,
        id,
        type: post.type,
        merge: false
      }

      const response = await Factor.$db.update(query)

      Factor.$events.$emit("purge-url-cache", post.url)

      // Bust cache for url
      // if (!post.url.includes("localhost")) {
      //   Factor.$http.request({ url: post.url, method: "PURGE" })
      // }

      return data
    }

    async addRevision({ post, meta, save = false }) {
      let { revisions, ...postData } = post

      revisions = revisions || []

      const draft = {
        timestamp: Factor.$time.stamp(),
        editor: Factor.$user._id(),
        post: postData,
        ...meta
      }

      post.revisions = [draft, ...revisions]

      if (save) {
        const save = {
          id: this.id,
          revisions: this.post.revisions
        }
        await this.saveDraft(save)
      }

      return post
    }

    excerpt(content, { length = 30 } = {}) {
      if (!content) {
        return ""
      }
      let splitContent = Factor.$markdown
        .strip(content)
        .replace(/\n|\r/g, " ")
        .split(" ")

      let excerpt

      if (splitContent.length > length) {
        splitContent = splitContent.slice(0, length)
        excerpt = splitContent.join(" ") + "..."
      } else {
        excerpt = splitContent.join(" ")
      }

      return excerpt
    }
  })()
}