const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken')
const cookieParser = require('cookie-parser')
const app = express();
require('dotenv').config()

const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.use(cors({
    origin: [
        'http://localhost:5174',
        'http://localhost:5173',
        'https://job-hunter-9f79e.web.app',
        'https://job-hunter-9f79e.firebaseapp.com'
    ],
    credentials: true

}));
app.use(express.json());
app.use(cookieParser());

const Varification = (req, res, next) => {

    const token = req.cookies.token;
    if (!token) {
        return res.status(401).send('Unauthorize Access')
    }
    jwt.verify(token, process.env.ACCESS_TOKEN_SECURE, (err, decoded) => {
        if (err) {
            return res.status(403).send('Unauthorize Access')
        }
        req.user = decoded;
        next()
    })

}

const uri = `mongodb+srv://${process.env.USER_ID}:${process.env.USER_PASS}@cluster0.xihi8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");

        // jobs related apis
        // const JobCullection = client.db('jobPortal').collection('jobs');
        // const JobApplicationCollection = client.db('jobPortal').collection('job_applications');



        const JobCullection = client.db('jobs-portal').collection('jobs')
        const JobApplicationCollection = client.db('jobs-portal').collection('job-applications')



        // Auth related APIs

        app.post('/jwt', (req, res) => {
            const user = req.body;
            const Token = jwt.sign(user, process.env.ACCESS_TOKEN_SECURE, { expiresIn: '5h' })
            res
                .cookie('token', Token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
                })
                .send({ success: true })
        })

        app.post('/logout', (req, res) => {
            res.clearCookie('token', {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "none" : "strict"
            })
                .send({ success: true })
        })

        // jobs related APIs
        app.get('/jobs', async (req, res) => {
            const email = req.query.email;
            const sort = req.query?.sort;
            const search = req.query?.search;
            const minPrize = req.query.minPrize;
            const maxPrize = req.query.maxPrize

            let query = {};
            let sortQuery = {}
            if (email) {
                query = { hr_email: email }
            }
            if (sort === "true") {
                sortQuery = { "salaryRange.min": 1 }
            }
            if (search) {
                query.location = {
                    $regex: search, $options: 'i'
                }
            }
            if (minPrize && maxPrize) {
                query = {
                    ...query,
                    "salaryRange.min": { $gte: parseInt(minPrize )},
                    "salaryRange.max": { $lte: parseInt(maxPrize) }
                }
            }
            const cursor = JobCullection.find(query).sort(sortQuery);
            const result = await cursor.toArray();
            res.send(result);
        });

        app.get('/jobs/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await JobCullection.findOne(query);
            res.send(result);
        });

        app.post('/jobs', async (req, res) => {
            const newJob = req.body;
            const result = await JobCullection.insertOne(newJob);
            res.send(result);
        })


        // job application apis
        // get all data, get one data, get some data [o, 1, many]
        app.get('/job-application', Varification, async (req, res) => {
            const email = req.query.email;
            const userEmail = req.user.email;
            if (userEmail !== email) {
                return res.status(401).send({ message: 'forbidden Access' })
            }
            const query = { applicant_email: email }
            const result = await JobApplicationCollection.find(query).toArray();

            // fokira way to aggregate data
            for (const application of result) {
                // console.log(application.job_id)
                const query1 = { _id: new ObjectId(application.job_id) }
                const job = await JobCullection.findOne(query1);
                if (job) {
                    application.title = job.title;
                    application.location = job.location;
                    application.company = job.company;
                    application.company_logo = job.company_logo;
                }
            }

            res.send(result);
        })

        // app.get('/job-applications/:id') ==> get a specific job application by id

        app.get('/job-applications/jobs/:job_id', async (req, res) => {
            const jobId = req.params.job_id;
            console.log(jobId);
            const query = { job_id: jobId }
            const result = await JobApplicationCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/job-applications', async (req, res) => {
            const application = req.body;
            const result = await JobApplicationCollection.insertOne(application);

            // Not the best way (use aggregate) 
            // skip --> it
            const id = application.job_id;
            const query = { _id: new ObjectId(id) }
            const job = await JobCullection.findOne(query);
            let newCount = 0;
            if (job.applicationCount) {
                newCount = job.applicationCount + 1;
            }
            else {
                newCount = 1;
            }

            // now update the job info
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    applicationCount: newCount
                }
            }

            const updateResult = await JobCullection.updateOne(filter, updatedDoc);

            res.send(result);
        });

        app.delete('/job-application/:id', Varification, async (req, res) => {
            const id = req.params.id;
            console.log(id);
            const email = req.query.email;
            const userEmail = req.user.email;
            if (userEmail != email) {
                return res.status(403).send({ message: 'Unauthorize access' })
            }

            // delete the application count in jobs
            const query = {
                _id: new ObjectId(req.query.jobId)
            }

            const updatedDoc = {
                $inc: {
                    applicationCount: -1
                }
            }

            const updateResult = await JobCullection.updateOne(query, updatedDoc);


            const result = await JobApplicationCollection.deleteOne(query);
            res.send(result)
        })

        app.patch('/job-applications/:id', async (req, res) => {
            const id = req.params.id;
            const data = req.body;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    status: data.status
                }
            }
            const result = await JobApplicationCollection.updateOne(filter, updatedDoc);
            res.send(result)
        })


    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Job is falling from the sky')
})

app.listen(port, () => {
    console.log(`Job is waiting at: ${port}`)
})