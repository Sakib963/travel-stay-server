const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

// Middleware for JWT Verification
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access without token" });
  }
  // bearer token
  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

app.get("/", (req, res) => {
  res.send("Travel Stay is running.");
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.poiwoh3.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db("travelStayDB").collection("users");
    const ownersCollection = client.db("travelStayDB").collection("owners");
    const topCitiesCollection = client
      .db("travelStayDB")
      .collection("topCities");
    const roomsCollection = client.db("travelStayDB").collection("rooms");

    // Verify Admin MiddleWare
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ error: true, message: "Forbidden Access." });
      }
      next();
    };

    // Verify Owner MiddleWare
    const verifyOwner = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "owner") {
        return res
          .status(403)
          .send({ error: true, message: "Forbidden Access." });
      }
      next();
    };

    //  JWT
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });

      res.send({ token });
    });

    //  User Collection
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // Create User
    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      const query = { email: userInfo.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "User Already Exists" });
      }
      const result = await usersCollection.insertOne(userInfo);
      res.send(result);
    });

    // Check Admin
    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ admin: false });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });

    // Check Owner
    app.get("/users/owner/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ owner: false });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { owner: user?.role === "owner" };
      res.send(result);
    });

    // Make Admin
    app.patch("/users/admin/:id", async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const findResult = await usersCollection.findOne(query);
      const ownersResult = await ownersCollection.deleteOne({
        email: findResult.email,
      });

      const options = { upsert: true };

      const updateDoc = {
        $set: {
          role: "admin",
        },
      };

      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // Make Owner
    app.patch("/users/owner/:id", async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const owner = req.body;
      console.log(owner);
      const options = { upsert: true };

      const updateDoc = {
        $set: {
          role: "owner",
        },
      };
      const insertResult = await ownersCollection.insertOne(owner);
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // Top Cities
    app.get("/top-cities", async (req, res) => {
      const result = await roomsCollection
        .aggregate([
          {
            $group: {
              _id: "$city",
              numberOfHotels: { $sum: 1 },
              totalHotelsAvailable: {
                $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] },
              },
            },
          },
          {
            $sort: { numberOfHotels: -1 },
          },
          {
            $limit: 3,
          },
        ])
        .toArray();

      res.json(result);
    });

    // Create A Room
    app.post("/create-room", async (req, res) => {
      const roomData = req.body;
      const result = await roomsCollection.insertOne(roomData);
      res.send(result);
    });

    // Get All Rooms
    app.get("/all-rooms", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await roomsCollection.find().toArray();
      res.send(result);
    });

    // Handle Approve or Deny Rooms
    app.patch("/all-rooms/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const update = req.query.status;

      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };

      if (update === "approved") {
        const updateDoc = {
          $set: {
            status: "approved",
          },
        };

        const updateResult = await roomsCollection.updateOne(
          filter,
          updateDoc,
          options
        );
        res.send(updateResult);
      }

      if (update === "denied") {
        const updateDoc = {
          $set: {
            status: "denied",
          },
        };
        const updateResult = await roomsCollection.updateOne(
          filter,
          updateDoc,
          options
        );
        res.send(updateResult);
      }
    });

    // Get Rooms Data By Email
    app.get("/rooms", verifyJWT, verifyOwner, async (req, res) => {
      const email = req.query.email;
      const filter = { ownerEmail: email };
      const result = await roomsCollection.find(filter).toArray();
      res.send(result);
    });

    // Get A Single Room Data By ID
    app.get("/room/:id", verifyJWT, verifyOwner, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await roomsCollection.findOne(filter);
      res.send(result);
    });

    // Update Room Data
    app.patch("/room/:id", verifyJWT, verifyOwner, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedRoomData = req.body;

      const updateDoc = {
        $set: {
          ...updatedRoomData,
        },
      };
      const options = { upsert: true };

      const result = await roomsCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    // Delete Single Room Data
    app.delete("/room/:id", verifyJWT, verifyOwner, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };

      const result = await roomsCollection.deleteOne(filter);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Travel Stay is running on port: ${port}`);
});
